import { pool } from "@proarb/db";

// Butik is the only warehouse POS sales and order pickups draw from.
// TODO (Fas 6+): let a real till/order pick a warehouse explicitly once
// there's more than a back-of-house Centrallager to choose between.
export const DEFAULT_WAREHOUSE_ID = 1;

// ---------------------------------------------------------------------------
// Core stock ledger — every quantity change in the system should end up
// here. `quantityDelta` is signed: positive increases quantity_on_hand,
// negative decreases it. Accepts either the pool or an open transaction
// connection so callers (POS sale, order pickup, PO receiving, stocktake)
// can fold this into their own transaction.
// ---------------------------------------------------------------------------
export async function recordMovement(
  db,
  { variantId, warehouseId, type, quantityDelta, referenceType = null, referenceId = null, note = null, userId = null }
) {
  await db.query(
    `INSERT INTO stock_movements (product_variant_id, warehouse_id, type, quantity, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [variantId, warehouseId, type, quantityDelta, referenceType, referenceId, note, userId]
  );
  await db.query(
    `INSERT INTO stock_levels (product_variant_id, warehouse_id, quantity_on_hand)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity_on_hand = quantity_on_hand + VALUES(quantity_on_hand)`,
    [variantId, warehouseId, quantityDelta]
  );
}

export async function listWarehouses() {
  const [rows] = await pool.query(`SELECT * FROM warehouses ORDER BY name ASC`);
  return rows;
}

// ---------------------------------------------------------------------------
// Stock levels (lagersaldo)
// ---------------------------------------------------------------------------

export async function listStockLevels({ search = "", warehouseId, lowStockOnly = false, page = 1, pageSize = 50 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;
  const conditions = ["(p.name LIKE ? OR p.article_number LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)"];
  const params = [like, like, like, like];

  if (warehouseId) {
    conditions.push("sl.warehouse_id = ?");
    params.push(warehouseId);
  }
  if (lowStockOnly) {
    conditions.push("sl.reorder_point IS NOT NULL AND sl.quantity_on_hand < sl.reorder_point");
  }
  const where = conditions.join(" AND ");

  const [rows] = await pool.query(
    `SELECT sl.id, sl.quantity_on_hand, sl.reserved_qty, sl.reorder_point, sl.reorder_quantity,
            sl.warehouse_id, w.name AS warehouse_name,
            v.id AS variant_id, v.sku, v.barcode, v.color, v.size,
            p.id AS product_id, p.name AS product_name, p.article_number
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     WHERE ${where}
     ORDER BY p.name ASC, v.color ASC, v.size ASC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE ${where}`,
    params
  );

  return { rows, total, page, pageSize };
}

export async function setReorderSettings(variantId, warehouseId, { reorderPoint, reorderQuantity }) {
  await pool.query(
    `INSERT INTO stock_levels (product_variant_id, warehouse_id, reorder_point, reorder_quantity)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reorder_point = VALUES(reorder_point), reorder_quantity = VALUES(reorder_quantity)`,
    [variantId, warehouseId, reorderPoint ?? null, reorderQuantity ?? null]
  );
}

// Manual correction outside of a formal stocktake (e.g. setting the
// starting balance for a new product). Goes through the same ledger as
// everything else via an ADJUSTMENT movement.
export async function adjustStockManually({ variantId, warehouseId, newQuantity, note, userId }) {
  const [[level]] = await pool.query(
    `SELECT quantity_on_hand FROM stock_levels WHERE product_variant_id = ? AND warehouse_id = ?`,
    [variantId, warehouseId]
  );
  const current = level ? Number(level.quantity_on_hand) : 0;
  const delta = Number(newQuantity) - current;
  if (delta !== 0) {
    await recordMovement(pool, {
      variantId,
      warehouseId,
      type: "ADJUSTMENT",
      quantityDelta: delta,
      referenceType: "manual",
      note,
      userId,
    });
  }
}
