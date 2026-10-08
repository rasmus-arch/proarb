import { pool } from "../../lib/db.js";
import { DEFAULT_WAREHOUSE_ID } from "./service.js";

// Inköpsförslag: vad behöver beställas, och från vem.
//
// Två källor räknas ihop till EN rad per variant (inte en rad per order +
// en till för min-saldo, som annars gav dubbletter på inköpsordern):
//  1. Ordrar som inte är klara där lagret inte räcker. Ordrar markerade
//     "undanta från lagerhantering" räknas aldrig med.
//  2. Varianter under sitt min-saldo.
// Det som redan ligger på en öppen inköpsorder dras av, så inget föreslås
// två gånger. Leverantör = produktens egen leverantör (products.supplier_id,
// den som sätts i produktformuläret), annars billigaste i product_suppliers.
// Grupper utan leverantör sorteras sist. Utgångna produkter föreslås aldrig.

export async function getPurchaseSuggestions({ warehouseId = DEFAULT_WAREHOUSE_ID } = {}) {
  const [orderRows] = await pool.query(
    `SELECT ol.product_variant_id, ol.quantity, o.order_number, c.name AS customer_name
     FROM order_lines ol
     JOIN orders o ON o.id = ol.order_id
     JOIN customers c ON c.id = o.customer_id
     WHERE o.status NOT IN ('DELIVERED', 'CANCELLED', 'INVOICED')
       AND o.skip_inventory = 0
       AND ol.product_variant_id IS NOT NULL
     ORDER BY o.created_at ASC`
  );

  const [restockRows] = await pool.query(
    `SELECT product_variant_id, quantity_on_hand, reorder_point, reorder_quantity
     FROM stock_levels
     WHERE warehouse_id = ? AND reorder_point IS NOT NULL`,
    [warehouseId]
  );

  const [stockRows] = await pool.query(
    `SELECT product_variant_id, quantity_on_hand FROM stock_levels WHERE warehouse_id = ?`,
    [warehouseId]
  );
  const onHand = new Map(stockRows.map((r) => [r.product_variant_id, Number(r.quantity_on_hand)]));

  const [onOrderRows] = await pool.query(
    `SELECT pol.product_variant_id, SUM(pol.quantity - pol.received_qty) AS qty
     FROM purchase_order_lines pol
     JOIN purchase_orders po ON po.id = pol.purchase_order_id
     WHERE po.status != 'RECEIVED' AND pol.line_status != 'CLOSED'
     GROUP BY pol.product_variant_id
     HAVING qty > 0`
  );
  const onOrder = new Map(onOrderRows.map((r) => [r.product_variant_id, Number(r.qty)]));

  // Per variant: how much open orders need beyond what's in stock, and why.
  const needs = new Map();
  function need(variantId) {
    if (!needs.has(variantId)) needs.set(variantId, { orderQty: 0, restockQty: 0, reasons: [] });
    return needs.get(variantId);
  }

  // Stock is consumed by orders oldest-first; whatever an order can't be
  // covered by is what it contributes to the suggestion.
  const stockLeft = new Map(onHand);
  for (const row of orderRows) {
    const qty = Number(row.quantity);
    const n = need(row.product_variant_id);
    const available = Math.max(0, stockLeft.get(row.product_variant_id) ?? 0);
    const covered = Math.min(available, qty);
    stockLeft.set(row.product_variant_id, available - covered);
    const missing = qty - covered;
    if (missing > 0) {
      n.orderQty += missing;
      n.reasons.push({ type: "order", order_number: row.order_number, customer_name: row.customer_name, quantity: missing });
    }
  }

  // Min-saldo jämförs med det som är kvar efter öppna ordrar (tillgängligt),
  // inte med hyllsaldot — annars märks det inte att lagret redan är lovat bort.
  for (const row of restockRows) {
    const available = stockLeft.get(row.product_variant_id) ?? Number(row.quantity_on_hand);
    if (available >= Number(row.reorder_point)) continue;
    const deficit = Number(row.reorder_point) - available;
    const qty = row.reorder_quantity ? Number(row.reorder_quantity) : Math.ceil(deficit);
    const n = need(row.product_variant_id);
    n.restockQty += qty;
    n.reasons.push({ type: "restock", quantity_on_hand: available, reorder_point: Number(row.reorder_point) });
  }

  const variantIds = [...needs.entries()]
    .filter(([, n]) => n.orderQty + n.restockQty > 0)
    .map(([id]) => id);
  if (variantIds.length === 0) return [];

  const [variants] = await pool.query(
    `SELECT v.id AS product_variant_id, v.sku, v.color, v.size,
            p.id AS product_id, p.name AS product_name, p.article_number, p.cost_price AS product_cost_price,
            s.id AS supplier_id, s.name AS supplier_name
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE v.id IN (?) AND p.discontinued = 0`,
    [variantIds]
  );

  if (variants.length === 0) return [];
  const productIds = [...new Set(variants.map((v) => v.product_id))];
  const [supplierRows] = await pool.query(
    `SELECT ps.product_id, ps.supplier_id, s.name AS supplier_name, ps.cost_price, ps.supplier_sku
     FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id IN (?)
     ORDER BY ps.cost_price IS NULL, ps.cost_price ASC`,
    [productIds]
  );

  const groups = new Map();
  for (const v of variants) {
    const n = needs.get(v.product_variant_id);
    const offers = supplierRows.filter((r) => r.product_id === v.product_id);
    const offer = v.supplier_id ? offers.find((o) => o.supplier_id === v.supplier_id) : offers[0];
    const supplierId = v.supplier_id ?? offer?.supplier_id ?? 0;
    const supplierName = v.supplier_name ?? offer?.supplier_name ?? null;

    // Order shortfall must be bought; restock tops up on top of that. Both
    // are reduced by what's already on an open purchase order.
    const needed = n.orderQty + n.restockQty;
    const alreadyOnOrder = Math.min(onOrder.get(v.product_variant_id) ?? 0, needed);
    const suggested = needed - alreadyOnOrder;
    if (suggested <= 0) continue;

    if (!groups.has(supplierId)) {
      groups.set(supplierId, { supplier_id: supplierId, supplier_name: supplierName, lines: [] });
    }
    const costPrice = offer?.cost_price ?? v.product_cost_price;
    groups.get(supplierId).lines.push({
      product_variant_id: v.product_variant_id,
      product_id: v.product_id,
      product_name: v.product_name,
      article_number: v.article_number,
      supplier_sku: offer?.supplier_sku ?? null,
      sku: v.sku,
      color: v.color,
      size: v.size,
      stock_on_hand: onHand.get(v.product_variant_id) ?? 0,
      already_on_order_qty: alreadyOnOrder,
      suggested_qty: suggested,
      cost_price: costPrice === null || costPrice === undefined ? null : Number(costPrice),
      reasons: n.reasons,
    });
  }

  for (const g of groups.values()) {
    g.lines.sort((a, b) => a.product_name.localeCompare(b.product_name, "sv") || String(a.size).localeCompare(String(b.size), "sv"));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.supplier_id === 0) return 1;
    if (b.supplier_id === 0) return -1;
    return a.supplier_name.localeCompare(b.supplier_name, "sv");
  });
}
