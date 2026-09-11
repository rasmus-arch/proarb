import { pool } from "@proarb/db";
import { recordMovement } from "./service.js";

export async function listStockCounts({ warehouseId } = {}) {
  const where = warehouseId ? "WHERE sc.warehouse_id = ?" : "";
  const params = warehouseId ? [warehouseId] : [];
  const [rows] = await pool.query(
    `SELECT sc.*, w.name AS warehouse_name, u.name AS started_by_name
     FROM stock_counts sc
     JOIN warehouses w ON w.id = sc.warehouse_id
     LEFT JOIN users u ON u.id = sc.started_by
     ${where}
     ORDER BY sc.started_at DESC`,
    params
  );
  return rows;
}

// The core of the "juridiskt lämplig inventering": alongside what was
// actually scanned, also surface every variant that currently has stock
// on hand in this warehouse but was never scanned during the count — the
// list of "vad som bör finnas men som inte är scannat".
export async function getStockCount(id) {
  const [[count]] = await pool.query(
    `SELECT sc.*, w.name AS warehouse_name, u.name AS started_by_name
     FROM stock_counts sc
     JOIN warehouses w ON w.id = sc.warehouse_id
     LEFT JOIN users u ON u.id = sc.started_by
     WHERE sc.id = ?`,
    [id]
  );
  if (!count) return null;

  const [scannedLines] = await pool.query(
    `SELECT scl.*, v.sku, v.barcode, v.color, v.size, p.name AS product_name, u.name AS decided_by_name
     FROM stock_count_lines scl
     JOIN product_variants v ON v.id = scl.product_variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN users u ON u.id = scl.decided_by
     WHERE scl.stock_count_id = ?
     ORDER BY p.name ASC`,
    [id]
  );
  const scannedVariantIds = scannedLines.map((l) => l.product_variant_id);

  const [missing] = await pool.query(
    `SELECT sl.product_variant_id, sl.quantity_on_hand AS expected_qty,
            v.sku, v.barcode, v.color, v.size, p.name AS product_name
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE sl.warehouse_id = ? AND sl.quantity_on_hand > 0
       ${scannedVariantIds.length > 0 ? "AND sl.product_variant_id NOT IN (?)" : ""}
     ORDER BY p.name ASC`,
    scannedVariantIds.length > 0 ? [count.warehouse_id, scannedVariantIds] : [count.warehouse_id]
  );

  return {
    ...count,
    lines: scannedLines,
    missing: missing.map((m) => ({ ...m, counted_qty: 0, decision: "PENDING" })),
  };
}

export async function startStockCount({ warehouseId, userId }) {
  const [result] = await pool.query(`INSERT INTO stock_counts (warehouse_id, started_by) VALUES (?, ?)`, [
    warehouseId,
    userId,
  ]);
  return getStockCount(result.insertId);
}

async function upsertCountLine(countId, warehouseId, variantId, quantityToAdd) {
  const [[existing]] = await pool.query(
    `SELECT id, counted_qty FROM stock_count_lines WHERE stock_count_id = ? AND product_variant_id = ?`,
    [countId, variantId]
  );

  if (existing) {
    await pool.query(`UPDATE stock_count_lines SET counted_qty = counted_qty + ? WHERE id = ?`, [
      quantityToAdd,
      existing.id,
    ]);
    return;
  }

  const [[level]] = await pool.query(
    `SELECT quantity_on_hand FROM stock_levels WHERE product_variant_id = ? AND warehouse_id = ?`,
    [variantId, warehouseId]
  );
  const expectedQty = level ? Number(level.quantity_on_hand) : 0;

  await pool.query(
    `INSERT INTO stock_count_lines (stock_count_id, product_variant_id, counted_qty, expected_qty)
     VALUES (?, ?, ?, ?)`,
    [countId, variantId, quantityToAdd, expectedQty]
  );
}

export async function scanCountLine(countId, { barcode, quantity = 1 }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");
  if (count.status !== "IN_PROGRESS") throw new Error("COUNT_NOT_IN_PROGRESS");

  const [[variant]] = await pool.query(`SELECT id FROM product_variants WHERE barcode = ? AND active = 1`, [
    barcode,
  ]);
  if (!variant) throw new Error("BARCODE_NOT_FOUND");

  await upsertCountLine(countId, count.warehouse_id, variant.id, quantity);
  return getStockCount(countId);
}

export async function addCountLineManual(countId, { productVariantId, quantity }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");
  if (count.status !== "IN_PROGRESS") throw new Error("COUNT_NOT_IN_PROGRESS");

  await upsertCountLine(countId, count.warehouse_id, productVariantId, quantity);
  return getStockCount(countId);
}

// Applies one decision: ADJUST books an audited ADJUSTMENT movement that
// brings lagersaldo to match what was actually counted; KEEP just marks
// the discrepancy as reviewed-and-accepted without changing stock. Either
// way it's on the record who decided and when.
async function applyDecision(connection, countId, line, decision, userId) {
  if (decision === "ADJUST") {
    const delta = Number(line.counted_qty) - Number(line.expected_qty);
    if (delta !== 0) {
      await recordMovement(connection, {
        variantId: line.product_variant_id,
        warehouseId: line.warehouse_id,
        type: "ADJUSTMENT",
        quantityDelta: delta,
        referenceType: "stock_count",
        referenceId: countId,
        userId,
      });
    }
  }
  await connection.query(
    `UPDATE stock_count_lines SET decision = ?, decided_by = ?, decided_at = NOW() WHERE id = ?`,
    [decision, userId, line.id]
  );
}

export async function decideLine(countId, lineId, { decision, userId }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[line]] = await connection.query(`SELECT * FROM stock_count_lines WHERE id = ? AND stock_count_id = ?`, [
      lineId,
      countId,
    ]);
    if (!line) throw new Error("LINE_NOT_FOUND");

    await applyDecision(connection, countId, { ...line, warehouse_id: count.warehouse_id }, decision, userId);
    await connection.commit();
    return getStockCount(countId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// A "missing" item (expected but never scanned) doesn't have a
// stock_count_lines row yet — materialize one (counted_qty = 0) before
// deciding, so the decision is recorded the same way as any other line.
export async function decideMissing(countId, { productVariantId, decision, userId }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");

  const missingItem = count.missing.find((m) => m.product_variant_id === productVariantId);
  if (!missingItem) throw new Error("NOT_MISSING");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO stock_count_lines (stock_count_id, product_variant_id, counted_qty, expected_qty)
       VALUES (?, ?, 0, ?)`,
      [countId, productVariantId, missingItem.expected_qty]
    );
    const line = {
      id: result.insertId,
      product_variant_id: productVariantId,
      counted_qty: 0,
      expected_qty: missingItem.expected_qty,
      warehouse_id: count.warehouse_id,
    };
    await applyDecision(connection, countId, line, decision, userId);
    await connection.commit();
    return getStockCount(countId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Bulk apply one decision to every still-pending discrepancy (scanned
// mismatches and missing items alike).
export async function decideAll(countId, { decision, userId }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");

  for (const line of count.lines) {
    if (line.decision === "PENDING" && Number(line.counted_qty) !== Number(line.expected_qty)) {
      await decideLine(countId, line.id, { decision, userId });
    }
  }
  for (const missing of count.missing) {
    await decideMissing(countId, { productVariantId: missing.product_variant_id, decision, userId });
  }
  return getStockCount(countId);
}

// Only completable once every discrepancy has an explicit decision —
// that's what makes the count legally defensible: nothing was silently
// skipped.
export async function completeStockCount(countId) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");
  if (count.status !== "IN_PROGRESS") throw new Error("COUNT_NOT_IN_PROGRESS");

  const unresolved =
    count.lines.some((l) => l.decision === "PENDING" && Number(l.counted_qty) !== Number(l.expected_qty)) ||
    count.missing.length > 0;
  if (unresolved) throw new Error("UNRESOLVED_DISCREPANCIES");

  await pool.query(`UPDATE stock_counts SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?`, [countId]);
  return getStockCount(countId);
}
