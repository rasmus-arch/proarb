import { pool } from "../../lib/db.js";
import { DEFAULT_WAREHOUSE_ID } from "./service.js";

const NO_SUPPLIER = { supplier_id: 0, supplier_name: "Ingen leverantör vald" };

async function preferredSuppliersByProduct(productIds) {
  const map = new Map();
  if (productIds.length === 0) return map;

  const [rows] = await pool.query(
    `SELECT ps.product_id, ps.supplier_id, s.name AS supplier_name, ps.cost_price
     FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id IN (?)
     ORDER BY ps.cost_price IS NULL, ps.cost_price ASC`,
    [productIds]
  );
  for (const row of rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, row);
  }
  return map;
}

// Two sources, both grouped by supplier per the user's spec:
//  1. Order-driven: rader på ordrar som inte är klara där man antingen
//     valt "beställ ändå" (sourcing = PURCHASE) eller där lagersaldot
//     inte räcker till hela raden.
//  2. Lågt-lager-driven: produkter under sitt satta minsta lagersaldo,
//     inte kopplade till en specifik order.
export async function getPurchaseSuggestions({ warehouseId = DEFAULT_WAREHOUSE_ID } = {}) {
  const [orderRows] = await pool.query(
    `SELECT ol.id AS order_line_id, ol.order_id, o.order_number, ol.product_variant_id, ol.quantity, ol.sourcing,
            o.customer_id, c.name AS customer_name,
            COALESCE(sl.quantity_on_hand, 0) AS stock_on_hand,
            v.sku, v.barcode, v.color, v.size, p.id AS product_id, p.name AS product_name
     FROM order_lines ol
     JOIN orders o ON o.id = ol.order_id
     JOIN customers c ON c.id = o.customer_id
     JOIN product_variants v ON v.id = ol.product_variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN stock_levels sl ON sl.product_variant_id = ol.product_variant_id AND sl.warehouse_id = ?
     WHERE o.status NOT IN ('DELIVERED', 'CANCELLED', 'INVOICED')
       AND (ol.sourcing = 'PURCHASE' OR ol.quantity > COALESCE(sl.quantity_on_hand, 0))
     ORDER BY o.created_at ASC`,
    [warehouseId]
  );

  const [restockRows] = await pool.query(
    `SELECT sl.product_variant_id, sl.warehouse_id, w.name AS warehouse_name,
            sl.quantity_on_hand, sl.reorder_point, sl.reorder_quantity,
            v.sku, v.barcode, v.color, v.size, p.id AS product_id, p.name AS product_name
     FROM stock_levels sl
     JOIN warehouses w ON w.id = sl.warehouse_id
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE sl.reorder_point IS NOT NULL AND sl.quantity_on_hand < sl.reorder_point
     ORDER BY p.name ASC`
  );

  const productIds = [...new Set([...orderRows, ...restockRows].map((r) => r.product_id))];
  const suppliers = await preferredSuppliersByProduct(productIds);

  const bySupplier = new Map();
  function bucket(productId) {
    const supplier = suppliers.get(productId) ?? NO_SUPPLIER;
    const key = supplier.supplier_id;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplier_id: supplier.supplier_id,
        supplier_name: supplier.supplier_name,
        order_driven: [],
        restock_driven: [],
      });
    }
    return bySupplier.get(key);
  }

  const orderGroups = new Map(); // supplierKey -> orderId -> lines[]
  for (const row of orderRows) {
    const missingQty = Math.max(0, Number(row.quantity) - Number(row.stock_on_hand));
    const supplierBucket = bucket(row.product_id);
    let orderGroup = supplierBucket.order_driven.find((g) => g.order_id === row.order_id);
    if (!orderGroup) {
      orderGroup = { order_id: row.order_id, order_number: row.order_number, customer_name: row.customer_name, lines: [] };
      supplierBucket.order_driven.push(orderGroup);
    }
    orderGroup.lines.push({
      order_line_id: row.order_line_id,
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      sku: row.sku,
      color: row.color,
      size: row.size,
      ordered_qty: Number(row.quantity),
      stock_on_hand: Number(row.stock_on_hand),
      suggested_qty: row.sourcing === "PURCHASE" ? Number(row.quantity) : missingQty,
      forced: row.sourcing === "PURCHASE",
    });
  }

  for (const row of restockRows) {
    const supplierBucket = bucket(row.product_id);
    const deficit = Number(row.reorder_point) - Number(row.quantity_on_hand);
    supplierBucket.restock_driven.push({
      product_variant_id: row.product_variant_id,
      product_name: row.product_name,
      sku: row.sku,
      color: row.color,
      size: row.size,
      warehouse_name: row.warehouse_name,
      quantity_on_hand: Number(row.quantity_on_hand),
      reorder_point: Number(row.reorder_point),
      suggested_qty: row.reorder_quantity ? Number(row.reorder_quantity) : Math.ceil(deficit),
    });
  }

  return [...bySupplier.values()].filter((b) => b.order_driven.length > 0 || b.restock_driven.length > 0);
}
