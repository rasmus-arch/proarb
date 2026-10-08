import { pool } from "../../lib/db.js";
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

// Del-inventering: vilken produktkolumn varje omfattning filtrerar på.
const SCOPE_COLUMNS = { CATEGORY: "category_id", BRAND: "brand_id", SUPPLIER: "supplier_id" };
const SCOPE_TABLES = { CATEGORY: "product_categories", BRAND: "brands", SUPPLIER: "suppliers" };

// SQL-villkor (på products p) för att en vara ingår i inventeringen.
function scopeCondition(count) {
  const column = SCOPE_COLUMNS[count.scope_type];
  if (column) return { sql: `AND p.${column} = ?`, params: [count.scope_id] };
  return { sql: "", params: [] };
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

  // Stickprov (SCANNED): bara det som räknats bedöms — inget kan "saknas".
  if (count.scope_type === "SCANNED") return { ...count, lines: scannedLines, missing: [] };
  const scope = scopeCondition(count);

  const [missing] = await pool.query(
    `SELECT sl.product_variant_id, sl.quantity_on_hand AS expected_qty,
            v.sku, v.barcode, v.color, v.size, p.name AS product_name
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE sl.warehouse_id = ? AND sl.quantity_on_hand > 0
       ${scope.sql}
       ${scannedVariantIds.length > 0 ? "AND sl.product_variant_id NOT IN (?)" : ""}
     ORDER BY p.name ASC`,
    [count.warehouse_id, ...scope.params, ...(scannedVariantIds.length > 0 ? [scannedVariantIds] : [])]
  );

  return {
    ...count,
    lines: scannedLines,
    missing: missing.map((m) => ({ ...m, counted_qty: 0, decision: "PENDING" })),
  };
}

export async function startStockCount({ warehouseId, userId, scopeType = "FULL", scopeId = null }) {
  const type = ["FULL", "CATEGORY", "BRAND", "SUPPLIER", "SCANNED"].includes(scopeType) ? scopeType : "FULL";
  let label = null;
  if (SCOPE_TABLES[type]) {
    const [[row]] = await pool.query(`SELECT name FROM ${SCOPE_TABLES[type]} WHERE id = ?`, [scopeId]);
    if (!row) throw new Error("INVALID_SCOPE");
    label = row.name;
  }
  const [result] = await pool.query(
    `INSERT INTO stock_counts (warehouse_id, started_by, scope_type, scope_id, scope_label) VALUES (?, ?, ?, ?, ?)`,
    [warehouseId, userId, type, SCOPE_TABLES[type] ? scopeId : null, label]
  );
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

  // SKU räknas också, så att etiketter från streckkodsarket fungerar.
  const [[variant]] = await pool.query(
    `SELECT id FROM product_variants WHERE (barcode = ? OR sku = ?) AND active = 1 ORDER BY barcode = ? DESC LIMIT 1`,
    [barcode, barcode, barcode]
  );
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
// mismatches and missing items alike). Does the whole batch in a single
// transaction and reloads the count once at the end — calling
// decideLine/decideMissing in a loop would reload the full count (header +
// lines + missing) twice per item, an N+1 that stalls on a warehouse with
// many discrepancies. This also makes the batch atomic: a failure partway
// through rolls back every decision instead of leaving some applied.
export async function decideAll(countId, { decision, userId }) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const line of count.lines) {
      if (line.decision === "PENDING" && Number(line.counted_qty) !== Number(line.expected_qty)) {
        await applyDecision(connection, countId, { ...line, warehouse_id: count.warehouse_id }, decision, userId);
      }
    }

    // A "missing" item doesn't have a stock_count_lines row yet —
    // materialize one (counted_qty = 0) before deciding, same as
    // decideMissing does for a single item.
    for (const missing of count.missing) {
      const [result] = await connection.query(
        `INSERT INTO stock_count_lines (stock_count_id, product_variant_id, counted_qty, expected_qty)
         VALUES (?, ?, 0, ?)`,
        [countId, missing.product_variant_id, missing.expected_qty]
      );
      const line = {
        id: result.insertId,
        product_variant_id: missing.product_variant_id,
        counted_qty: 0,
        expected_qty: missing.expected_qty,
        warehouse_id: count.warehouse_id,
      };
      await applyDecision(connection, countId, line, decision, userId);
    }

    await connection.commit();
    return getStockCount(countId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
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

// --- Mobilinventering, hylla för hylla -------------------------------------
// Hyllorna kommer från products.shelf_location. En hylla visar det som
// borde stå där (saldo > 0 inom inventeringens omfattning) plus det som
// redan räknats; varor utan hyllplats samlas under "" ("Utan hyllplats").
// Räkningen är fortfarande per variant i hela lagret — samma rader som
// inventeringen på datorn, så avvikelser beslutas där som vanligt.

async function countForShelves(countId) {
  const count = await getStockCount(countId);
  if (!count) throw new Error("COUNT_NOT_FOUND");
  return count;
}

function shelfItemsQuery(count, shelfSql) {
  const scope = scopeCondition(count);
  return {
    sql: `SELECT v.id AS variant_id, v.sku, v.barcode, v.color, v.size, p.name AS product_name,
                 COALESCE(p.shelf_location, '') AS shelf_location,
                 COALESCE(sl.quantity_on_hand, 0) AS expected_qty, scl.counted_qty
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          LEFT JOIN stock_levels sl ON sl.product_variant_id = v.id AND sl.warehouse_id = ?
          LEFT JOIN stock_count_lines scl ON scl.product_variant_id = v.id AND scl.stock_count_id = ?
          WHERE (scl.id IS NOT NULL OR (COALESCE(sl.quantity_on_hand, 0) > 0 AND v.active = 1 ${
            count.scope_type === "SCANNED" ? "AND 1 = 0" : scope.sql
          }))
            ${shelfSql}`,
    params: [count.warehouse_id, count.id, ...(count.scope_type === "SCANNED" ? [] : scope.params)],
  };
}

export async function listCountShelves(countId) {
  const count = await countForShelves(countId);
  const q = shelfItemsQuery(count, "");
  const [rows] = await pool.query(
    `SELECT items.shelf_location, COUNT(*) AS item_count,
            SUM(items.counted_qty IS NOT NULL) AS counted_count,
            scs.completed_at, u.name AS completed_by_name
     FROM (${q.sql}) items
     LEFT JOIN stock_count_shelves scs ON scs.stock_count_id = ? AND scs.shelf_location = items.shelf_location
     LEFT JOIN users u ON u.id = scs.completed_by
     GROUP BY items.shelf_location, scs.completed_at, u.name`,
    [...q.params, count.id]
  );
  const collator = new Intl.Collator("sv", { numeric: true, sensitivity: "base" });
  rows.sort((a, b) => (a.shelf_location === "") - (b.shelf_location === "") || collator.compare(a.shelf_location, b.shelf_location));
  return {
    count: { id: count.id, status: count.status, scope_type: count.scope_type, scope_label: count.scope_label, started_at: count.started_at },
    shelves: rows.map((r) => ({
      ...r,
      item_count: Number(r.item_count),
      counted_count: Number(r.counted_count),
      done: Boolean(r.completed_at),
    })),
  };
}

export async function getCountShelf(countId, shelf) {
  const count = await countForShelves(countId);
  const q = shelfItemsQuery(count, "AND COALESCE(p.shelf_location, '') = ?");
  const [items] = await pool.query(`${q.sql} ORDER BY p.name ASC, v.color ASC, v.size ASC`, [...q.params, shelf]);
  const [[done]] = await pool.query(
    `SELECT completed_at FROM stock_count_shelves WHERE stock_count_id = ? AND shelf_location = ?`,
    [count.id, shelf]
  );
  return {
    count: { id: count.id, status: count.status },
    shelf,
    done: Boolean(done),
    items: items.map((i) => ({
      ...i,
      expected_qty: Number(i.expected_qty),
      counted_qty: i.counted_qty === null ? null : Number(i.counted_qty),
    })),
  };
}

// Sätter det räknade antalet exakt (rätta en felskanning), till skillnad
// från skanningen som lägger till.
export async function setCountedQty(countId, variantId, quantity) {
  const count = await countForShelves(countId);
  if (count.status !== "IN_PROGRESS") throw new Error("COUNT_NOT_IN_PROGRESS");
  const qty = Math.max(0, Number(quantity) || 0);
  const [[existing]] = await pool.query(
    `SELECT id FROM stock_count_lines WHERE stock_count_id = ? AND product_variant_id = ?`,
    [countId, variantId]
  );
  if (existing) {
    await pool.query(`UPDATE stock_count_lines SET counted_qty = ? WHERE id = ?`, [qty, existing.id]);
  } else {
    await upsertCountLine(countId, count.warehouse_id, variantId, qty);
  }
}

export async function setShelfDone(countId, shelf, { done, userId }) {
  const count = await countForShelves(countId);
  if (count.status !== "IN_PROGRESS") throw new Error("COUNT_NOT_IN_PROGRESS");
  if (done) {
    await pool.query(
      `INSERT INTO stock_count_shelves (stock_count_id, shelf_location, completed_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE completed_by = VALUES(completed_by), completed_at = NOW()`,
      [countId, shelf, userId]
    );
  } else {
    await pool.query(`DELETE FROM stock_count_shelves WHERE stock_count_id = ? AND shelf_location = ?`, [countId, shelf]);
  }
}
