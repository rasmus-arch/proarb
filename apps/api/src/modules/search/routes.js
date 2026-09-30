import { Router } from "express";
import { pool } from "../../lib/db.js";

// Global sökning för sökfältet i menyn. "exact" är en direktträff från en
// skannad streckkod eller ett helt nummer (ordernr, offertnr, EAN/SKU) —
// då hoppar klienten direkt dit. Annars grupperade fritextträffar.
const router = Router();
const LIMIT = 5;

async function findExact(q) {
  const [[order]] = await pool.query(`SELECT id, order_number FROM orders WHERE order_number = ?`, [q]);
  if (order) return { type: "order", id: order.id, label: order.order_number };

  const [[quote]] = await pool.query(`SELECT id, quote_number FROM quotes WHERE quote_number = ?`, [q]);
  if (quote) return { type: "quote", id: quote.id, label: quote.quote_number };

  const [[variant]] = await pool.query(
    `SELECT v.id AS variant_id, v.product_id, p.name FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.barcode = ? OR v.sku = ? ORDER BY v.barcode = ? DESC LIMIT 1`,
    [q, q, q]
  );
  if (variant) return { type: "product", id: variant.product_id, variantId: variant.variant_id, label: variant.name };

  const [[product]] = await pool.query(`SELECT id, name FROM products WHERE article_number = ?`, [q]);
  if (product) return { type: "product", id: product.id, label: product.name };

  const [[customer]] = await pool.query(`SELECT id, name FROM customers WHERE customer_number = ?`, [q]);
  if (customer) return { type: "customer", id: customer.id, label: customer.name };

  return null;
}

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json({ exact: null, customers: [], orders: [], quotes: [], products: [] });
    const like = `%${q}%`;

    const [exact, [customers], [orders], [quotes], [products]] = await Promise.all([
      findExact(q),
      pool.query(
        `SELECT id, name, customer_number, city FROM customers
         WHERE active = 1 AND (name LIKE ? OR customer_number LIKE ? OR org_number LIKE ?)
         ORDER BY name ASC LIMIT ?`,
        [like, like, like, LIMIT]
      ),
      pool.query(
        `SELECT o.id, o.order_number, o.status, c.name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.order_number LIKE ? OR c.name LIKE ? ORDER BY o.created_at DESC LIMIT ?`,
        [like, like, LIMIT]
      ),
      pool.query(
        `SELECT q.id, q.quote_number, q.status, c.name AS customer_name FROM quotes q JOIN customers c ON c.id = q.customer_id
         WHERE q.quote_number LIKE ? OR c.name LIKE ? ORDER BY q.created_at DESC LIMIT ?`,
        [like, like, LIMIT]
      ),
      pool.query(
        `SELECT p.id, p.name, p.article_number FROM products p
         WHERE p.active = 1 AND (p.name LIKE ? OR p.article_number LIKE ?
           OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND (v.sku LIKE ? OR v.barcode = ?)))
         ORDER BY p.name ASC LIMIT ?`,
        [like, like, like, q, LIMIT]
      ),
    ]);

    res.json({ exact, customers, orders, quotes, products });
  } catch (err) {
    next(err);
  }
});

export default router;
