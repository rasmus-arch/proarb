import { pool } from "../../lib/db.js";
import { resolveNameToId } from "../catalog/service.js";

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
            p.id AS product_id, p.name, p.base_price, p.cost_price, p.tax_rate_percent
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.barcode = ? AND v.active = 1`,
    [barcode]
  );
  return variant ?? null;
}

// Small autocomplete result set used by the quote/order line builder.
// Includes cost_price so the UI can show margin as lines are added.
export async function searchVariants(search = "", limit = 15) {
  const like = `%${search}%`;
  const [rows] = await pool.query(
    `SELECT v.id AS variant_id, v.sku, v.barcode, v.color, v.size, v.price_override,
            p.id AS product_id, p.name, p.base_price, p.cost_price, p.tax_rate_percent, p.printable
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.active = 1 AND p.active = 1
       AND (p.name LIKE ? OR p.article_number LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)
     ORDER BY p.name ASC
     LIMIT ?`,
    [like, like, like, like, limit]
  );
  return rows;
}

export async function getProduct(id) {
  const [[product]] = await pool.query(`SELECT * FROM products WHERE id = ?`, [id]);
  if (!product) return null;

  const [variants] = await pool.query(
    `SELECT * FROM product_variants WHERE product_id = ? ORDER BY color ASC, size ASC`,
    [id]
  );
  const [suppliers] = await pool.query(
    `SELECT ps.id, ps.supplier_id, s.name AS supplier_name, ps.supplier_sku, ps.cost_price, ps.lead_time_days
     FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id = ? ORDER BY ps.cost_price IS NULL, ps.cost_price ASC`,
    [id]
  );

  return { ...product, variants, suppliers };
}

export async function addSupplier(productId, { supplierId, supplierSku, costPrice, leadTimeDays }) {
  await pool.query(
    `INSERT INTO product_suppliers (product_id, supplier_id, supplier_sku, cost_price, lead_time_days)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE supplier_sku = VALUES(supplier_sku), cost_price = VALUES(cost_price), lead_time_days = VALUES(lead_time_days)`,
    [productId, supplierId, supplierSku ?? null, costPrice ?? null, leadTimeDays ?? null]
  );
  return getProduct(productId);
}

export async function createProduct(data) {
  const categoryId = data.categoryId ?? (await resolveNameToId("product_categories", data.category));
  const brandId = data.brandId ?? (await resolveNameToId("brands", data.brand));

  const [result] = await pool.query(
    `INSERT INTO products
       (article_number, name, description, category_id, brand_id, printable, unit, tax_rate_percent, base_price, cost_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.articleNumber,
      data.name,
      data.description ?? null,
      categoryId,
      brandId,
      data.printable ? 1 : 0,
      data.unit ?? "st",
      data.taxRatePercent ?? 25,
      data.basePrice,
      data.costPrice ?? null,
    ]
  );

  const productId = result.insertId;

  const variants = Array.isArray(data.variants) && data.variants.length > 0 ? data.variants : [{}];
  for (const variant of variants) {
    await addVariant(productId, variant, data.articleNumber);
  }

  return getProduct(productId);
}

export async function updateProduct(id, data) {
  const fields = {
    name: data.name,
    description: data.description,
    category_id: data.categoryId,
    brand_id: data.brandId,
    printable: data.printable === undefined ? undefined : data.printable ? 1 : 0,
    unit: data.unit,
    tax_rate_percent: data.taxRatePercent,
    base_price: data.basePrice,
    cost_price: data.costPrice,
  };

  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length > 0) {
    const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await pool.query(`UPDATE products SET ${setClause} WHERE id = ?`, [...values, id]);
  }

  return getProduct(id);
}

export async function deactivateProduct(id) {
  await pool.query(`UPDATE products SET active = 0 WHERE id = ?`, [id]);
  await pool.query(`UPDATE product_variants SET active = 0 WHERE product_id = ?`, [id]);
}

function autoSku(articleNumber, variant, index) {
  const parts = [articleNumber, variant.color, variant.size].filter(Boolean);
  return parts.length > 1 ? parts.join("-").toUpperCase() : `${articleNumber}-${index + 1}`;
}

export async function addVariant(productId, data, articleNumberForSku, index = 0) {
  const sku = data.sku?.trim() || autoSku(articleNumberForSku ?? `P${productId}`, data, index);

  const [result] = await pool.query(
    `INSERT INTO product_variants (product_id, sku, barcode, color, size, price_override)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [productId, sku, data.barcode || null, data.color ?? null, data.size ?? null, data.priceOverride ?? null]
  );

  const [[variant]] = await pool.query(`SELECT * FROM product_variants WHERE id = ?`, [result.insertId]);
  return variant;
}
