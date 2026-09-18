import { pool } from "../../lib/db.js";

// Produktpaket: en generisk, återanvändbar kombination av produkter (t.ex.
// "Nyanställd-kit") som går att lägga till i valfri offert/order med ett
// klick. Samma rad-shape som products/service.js searchVariants (variant_id,
// name, color, size, sku, price_override, base_price, cost_price,
// tax_rate_percent, suggested_discount_percent) — så frontendens befintliga
// "variant -> radobjekt"-mappning funkar oförändrad på ett paketets rader.
const DISCOUNT_SELECT = `
  COALESCE(
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND product_id = p.id LIMIT 1),
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND supplier_id = p.supplier_id LIMIT 1),
    0
  ) AS suggested_discount_percent
`;

export async function listKits() {
  const [rows] = await pool.query(
    `SELECT k.id, k.name, k.created_at, COUNT(kl.id) AS line_count
     FROM product_kits k
     LEFT JOIN product_kit_lines kl ON kl.kit_id = k.id
     GROUP BY k.id
     ORDER BY k.name ASC`
  );
  return rows;
}

// customerId (valfritt): när den ges räknas varje rads
// suggested_discount_percent fram för just den kunden, exakt som
// /products/search — så "Lägg till paket" prissätts likadant som att lägga
// till varje produkt för sig hade gjort.
export async function getKit(id, customerId = null) {
  const [[kit]] = await pool.query(`SELECT * FROM product_kits WHERE id = ?`, [id]);
  if (!kit) return null;

  const [lines] = await pool.query(
    `SELECT kl.id AS kit_line_id, kl.quantity AS kit_quantity,
            v.id AS variant_id, v.sku, v.barcode, v.color, v.size, v.price_override,
            p.id AS product_id, p.name, p.base_price, p.cost_price, p.tax_rate_percent,
            ${DISCOUNT_SELECT}
     FROM product_kit_lines kl
     JOIN product_variants v ON v.id = kl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE kl.kit_id = ?
     ORDER BY kl.sort_order ASC`,
    [customerId ?? 0, customerId ?? 0, id]
  );

  return { ...kit, lines };
}

async function insertKitLines(connection, kitId, lines) {
  let sortOrder = 0;
  for (const line of lines) {
    const quantity = Number(line.quantity) || 1;
    if (!line.productVariantId) continue;
    await connection.query(
      `INSERT INTO product_kit_lines (kit_id, product_variant_id, quantity, sort_order) VALUES (?, ?, ?, ?)`,
      [kitId, line.productVariantId, quantity, sortOrder++]
    );
  }
}

export async function createKit({ name, lines }) {
  if (!name?.trim()) throw new Error("NAME_REQUIRED");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("LINES_REQUIRED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(`INSERT INTO product_kits (name) VALUES (?)`, [name.trim()]);
    const kitId = result.insertId;
    await insertKitLines(connection, kitId, lines);
    await connection.commit();
    return getKit(kitId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Full-replace av radlistan — samma resonemang som quotes.updateQuote:
// enklare och säkrare än att diffa mot befintliga rader.
export async function updateKit(id, { name, lines }) {
  const existing = await getKit(id);
  if (!existing) throw new Error("KIT_NOT_FOUND");
  if (!name?.trim()) throw new Error("NAME_REQUIRED");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("LINES_REQUIRED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`UPDATE product_kits SET name = ? WHERE id = ?`, [name.trim(), id]);
    await connection.query(`DELETE FROM product_kit_lines WHERE kit_id = ?`, [id]);
    await insertKitLines(connection, id, lines);
    await connection.commit();
    return getKit(id);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function deleteKit(id) {
  await pool.query(`DELETE FROM product_kit_lines WHERE kit_id = ?`, [id]);
  const [result] = await pool.query(`DELETE FROM product_kits WHERE id = ?`, [id]);
  if (result.affectedRows === 0) throw new Error("KIT_NOT_FOUND");
}
