import { pool } from "@proarb/db";

export async function listProducts({ search = "", page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;

  const [rows] = await pool.query(
    `SELECT p.id, p.article_number, p.name, p.base_price, p.active,
            v.id AS variant_id, v.sku, v.barcode, v.color, v.size
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = 1
     WHERE p.active = 1 AND (p.name LIKE ? OR p.article_number LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
     ORDER BY p.name ASC, v.color ASC, v.size ASC
     LIMIT ? OFFSET ?`,
    [like, like, like, like, pageSize, offset]
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT p.id) AS total
     FROM products p
     LEFT JOIN product_variants v ON v.product_id = p.id
     WHERE p.active = 1 AND (p.name LIKE ? OR p.article_number LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)`,
    [like, like, like, like]
  );

  return { rows, total, page, pageSize };
}

// Used by the POS / warehouse scanning flows: look up a sellable variant
// directly by the barcode a scanner just read.
export async function findVariantByBarcode(barcode) {
  const [[variant]] = await pool.query(
    `SELECT v.id AS variant_id, v.sku, v.barcode, v.color, v.size, v.price_override,
            p.id AS product_id, p.name, p.base_price, p.tax_rate_percent
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.barcode = ? AND v.active = 1`,
    [barcode]
  );
  return variant ?? null;
}
