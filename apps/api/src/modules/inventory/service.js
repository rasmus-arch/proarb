import { pool } from "../../lib/db.js";

// Butik is the only warehouse POS sales and order pickups draw from.
// TODO (Fas 6+): let a real till/order pick a warehouse explicitly once
// there's more than a back-of-house Centrallager to choose between.
export const DEFAULT_WAREHOUSE_ID = 1;

// Reserverat = antal på öppna ordrar (Order / Redo för utlämning) som inte
// är undantagna från lagret. Räknas fram, inte sparat, så det kan aldrig
// glida isär från ordrarna. Tillgängligt = saldo - reserverat. Gäller
// standardlagret (ordrar plockas därifrån). `variantExpr` är SQL för
// variantens id, t.ex. "v.id".
export function reservedQtySql(variantExpr, { excludeOrderId = null } = {}) {
  const exclude = excludeOrderId ? ` AND o.id <> ${Number(excludeOrderId)}` : "";
  return `COALESCE((SELECT SUM(rol.quantity) FROM order_lines rol JOIN orders o ON o.id = rol.order_id
     WHERE rol.product_variant_id = ${variantExpr} AND o.status IN ('NEW', 'READY_FOR_PICKUP')
       AND o.skip_inventory = 0${exclude}), 0)`;
}

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

// Lagervärde-export (CSV): hela lagersaldot med värde i både inköps- och
// försäljningspris (ex moms, produktens base_price — samma pris som
// offert/order utgår från innan ev. kundrabatt). Ingen paginering — det
// är hela poängen med en export, att få med allt i en fil.
function csvField(value) {
  const str = String(value ?? "");
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function exportStockValueCsv() {
  const [rows] = await pool.query(
    `SELECT p.article_number, p.name AS product_name, v.color, v.size, v.sku,
            w.name AS warehouse_name, sl.quantity_on_hand,
            p.cost_price, p.base_price
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     WHERE sl.quantity_on_hand <> 0
     ORDER BY p.name ASC, v.color ASC, v.size ASC`
  );

  const header = [
    "Artikelnr",
    "Produkt",
    "Färg",
    "Storlek",
    "SKU",
    "Lagerplats",
    "Antal i lager",
    "Inköpspris/st",
    "Inköpsvärde",
    "Försäljningspris/st (ex moms)",
    "Försäljningsvärde (ex moms)",
  ];

  let totalCostValue = 0;
  let totalSaleValue = 0;
  const lines = rows.map((r) => {
    const qty = Number(r.quantity_on_hand);
    const costPrice = r.cost_price === null ? null : Number(r.cost_price);
    const salePrice = r.base_price === null ? null : Number(r.base_price);
    const costValue = costPrice === null ? null : Math.round(qty * costPrice * 100) / 100;
    const saleValue = salePrice === null ? null : Math.round(qty * salePrice * 100) / 100;
    if (costValue !== null) totalCostValue += costValue;
    if (saleValue !== null) totalSaleValue += saleValue;
    return [
      r.article_number,
      r.product_name,
      r.color,
      r.size,
      r.sku,
      r.warehouse_name,
      qty,
      costPrice ?? "",
      costValue ?? "",
      salePrice ?? "",
      saleValue ?? "",
    ]
      .map(csvField)
      .join(";");
  });

  const totalRow = ["", "", "", "", "", "", "Totalt", "", Math.round(totalCostValue * 100) / 100, "", Math.round(totalSaleValue * 100) / 100]
    .map(csvField)
    .join(";");

  return "﻿" + [header.map(csvField).join(";"), ...lines, totalRow].join("\r\n");
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
    // Under min-saldo räknat på tillgängligt (saldo minus reserverat).
    conditions.push(
      `sl.reorder_point IS NOT NULL AND p.discontinued = 0 AND sl.quantity_on_hand -
         IF(sl.warehouse_id = ${Number(DEFAULT_WAREHOUSE_ID)}, ${reservedQtySql("v.id")}, 0) < sl.reorder_point`
    );
  }
  const where = conditions.join(" AND ");

  const [rows] = await pool.query(
    `SELECT sl.id, sl.quantity_on_hand, sl.reorder_point, sl.reorder_quantity,
            IF(sl.warehouse_id = ${Number(DEFAULT_WAREHOUSE_ID)}, ${reservedQtySql("v.id")}, 0) AS reserved_qty,
            sl.warehouse_id, w.name AS warehouse_name,
            v.id AS variant_id, v.sku, v.barcode, v.color, v.size,
            p.id AS product_id, p.name AS product_name, p.article_number, p.discontinued
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

  return {
    rows: rows.map((r) => ({
      ...r,
      quantity_on_hand: Number(r.quantity_on_hand),
      reserved_qty: Number(r.reserved_qty),
      available_qty: Number(r.quantity_on_hand) - Number(r.reserved_qty),
    })),
    total,
    page,
    pageSize,
  };
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

// Inkurans: artiklar i lager som inte sålts på `months` månader (eller
// aldrig). Artiklar som kom in i lagret senare än så räknas inte — de har
// inte haft en chans att säljas än. Värde i inköpspris (ex moms).
export async function getObsoleteStock(months) {
  const [rows] = await pool.query(
    `SELECT v.id AS variant_id, v.sku, v.color, v.size, p.id AS product_id, p.name AS product_name,
            p.article_number, p.discontinued, s.name AS supplier_name,
            SUM(sl.quantity_on_hand) AS quantity_on_hand, p.cost_price,
            SUM(sl.quantity_on_hand) * p.cost_price AS stock_value,
            mv.last_sale_at, mv.last_receipt_at
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     JOIN stock_levels sl ON sl.product_variant_id = v.id
     LEFT JOIN (
       SELECT product_variant_id,
              MAX(CASE WHEN type = 'SALE_OUT' THEN created_at END) AS last_sale_at,
              MAX(CASE WHEN type = 'PURCHASE_IN' THEN created_at END) AS last_receipt_at,
              MIN(created_at) AS first_movement_at
       FROM stock_movements GROUP BY product_variant_id
     ) mv ON mv.product_variant_id = v.id
     WHERE v.active = 1 AND p.active = 1
       AND COALESCE(mv.first_movement_at, p.created_at) < DATE_SUB(NOW(), INTERVAL ? MONTH)
       AND (mv.last_sale_at IS NULL OR mv.last_sale_at < DATE_SUB(NOW(), INTERVAL ? MONTH))
     GROUP BY v.id
     HAVING quantity_on_hand > 0
     ORDER BY p.cost_price IS NULL, SUM(sl.quantity_on_hand) * p.cost_price DESC, p.name ASC`,
    [months, months]
  );
  const items = rows.map((r) => ({
    ...r,
    discontinued: Boolean(r.discontinued),
    quantity_on_hand: Number(r.quantity_on_hand),
    cost_price: r.cost_price === null ? null : Number(r.cost_price),
    stock_value: r.stock_value === null ? null : Math.round(Number(r.stock_value) * 100) / 100,
  }));
  return {
    months,
    items,
    total_value: Math.round(items.reduce((sum, i) => sum + (i.stock_value ?? 0), 0) * 100) / 100,
    missing_cost: items.filter((i) => i.cost_price === null).length,
  };
}

// Lagerhistorik för en variant (Lager → Saldo → Historik): saldot dag för
// dag de senaste `months` månaderna (räknat baklänges från dagens saldo
// med lagerrörelserna), sålt antal per månad och de senaste rörelserna.
export async function getVariantHistory(variantId, months = 12) {
  const [[variant]] = await pool.query(
    `SELECT v.id AS variant_id, v.sku, v.color, v.size, p.name AS product_name, p.article_number,
            COALESCE((SELECT SUM(quantity_on_hand) FROM stock_levels WHERE product_variant_id = v.id), 0) AS quantity_on_hand,
            ${reservedQtySql("v.id")} AS reserved_qty
     FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
    [variantId]
  );
  if (!variant) return null;

  const [windowMoves] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, SUM(quantity) AS delta
     FROM stock_movements
     WHERE product_variant_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
     GROUP BY day ORDER BY day ASC`,
    [variantId, months]
  );
  const onHand = Number(variant.quantity_on_hand);
  let level = onHand - windowMoves.reduce((sum, m) => sum + Number(m.delta), 0);
  const deltas = new Map(windowMoves.map((m) => [m.day, Number(m.delta)]));

  // En punkt per dag (stegkurva), så att perioder utan rörelser syns som platta.
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const points = [];
  for (const d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const day = d.toLocaleDateString("sv-SE");
    level += deltas.get(day) ?? 0;
    points.push({ date: day, quantity: Math.round(level * 100) / 100 });
  }

  const [salesRows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, -SUM(quantity) AS sold
     FROM stock_movements
     WHERE product_variant_id = ? AND type = 'SALE_OUT' AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
     GROUP BY month`,
    [variantId, months]
  );
  const soldByMonth = new Map(salesRows.map((r) => [r.month, Number(r.sold)]));
  const sales = [];
  const m = new Date();
  m.setDate(1);
  m.setMonth(m.getMonth() - (months - 1));
  for (let i = 0; i < months; i++) {
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    sales.push({ month: key, sold: soldByMonth.get(key) ?? 0 });
    m.setMonth(m.getMonth() + 1);
  }

  const [movements] = await pool.query(
    `SELECT sm.id, sm.type, sm.quantity, sm.reference_type, sm.reference_id, sm.note, sm.created_at,
            u.name AS user_name, w.name AS warehouse_name,
            CASE WHEN sm.reference_type = 'order' THEN (SELECT order_number FROM orders WHERE id = sm.reference_id) END AS order_number
     FROM stock_movements sm
     LEFT JOIN users u ON u.id = sm.created_by
     LEFT JOIN warehouses w ON w.id = sm.warehouse_id
     WHERE sm.product_variant_id = ?
     ORDER BY sm.created_at DESC, sm.id DESC
     LIMIT 100`,
    [variantId]
  );

  return {
    variant: { ...variant, quantity_on_hand: onHand, reserved_qty: Number(variant.reserved_qty) },
    months,
    points,
    sales,
    movements: movements.map((mv) => ({ ...mv, quantity: Number(mv.quantity) })),
  };
}
