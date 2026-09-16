import { parse } from "csv-parse/sync";
import { pool } from "../../lib/db.js";

// Bulk CSV import for the product catalog. Designed for the "100 000+
// rows" scale mentioned in PLAN.md: rows are grouped in JS and written to
// MySQL in batched multi-row upserts instead of one query per row, so a
// large file is a few hundred round-trips rather than hundreds of
// thousands. (For an even larger recurring feed, the next step would be
// to stream-parse instead of buffering the whole file — noted in PLAN.md
// Fas 1 — but batched writes are the part that actually matters at this
// scale.)
//
// Expected layout: one row per sellable variant (color/size combination).
// Rows that share the same article number are grouped into one product
// with several variants. Swedish and English header names are both
// accepted.

const BATCH_SIZE = 500;

const HEADER_ALIASES = {
  articlenumber: "articleNumber",
  artikelnummer: "articleNumber",
  artikelnr: "articleNumber",
  name: "name",
  namn: "name",
  produktnamn: "name",
  category: "category",
  kategori: "category",
  brand: "brand",
  varumarke: "brand",
  "varumärke": "brand",
  supplier: "supplier",
  leverantor: "supplier",
  "leverantör": "supplier",
  baseprice: "basePrice",
  price: "basePrice",
  pris: "basePrice",
  "prisexmoms": "basePrice",
  costprice: "costPrice",
  inkopspris: "costPrice",
  "inköpspris": "costPrice",
  color: "color",
  farg: "color",
  "färg": "color",
  size: "size",
  storlek: "size",
  sku: "sku",
  barcode: "barcode",
  streckkod: "barcode",
  ean: "barcode",
  printable: "printable",
  tryckbar: "printable",
};

function normalizeHeader(header) {
  const key = header.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return HEADER_ALIASES[key] ?? header.trim();
}

function toBool(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "ja" || v === "yes" || v === "x";
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function resolveNameToId(table, names) {
  const uniqueNames = [...new Set(names.filter(Boolean))];
  const map = new Map();
  if (uniqueNames.length === 0) return map;

  const [existing] = await pool.query(`SELECT id, name FROM ${table} WHERE name IN (?)`, [uniqueNames]);
  for (const row of existing) map.set(row.name.toLowerCase(), row.id);

  const missing = uniqueNames.filter((n) => !map.has(n.toLowerCase()));
  for (const group of chunk(missing, BATCH_SIZE)) {
    if (group.length === 0) continue;
    await pool.query(`INSERT IGNORE INTO ${table} (name) VALUES ${group.map(() => "(?)").join(",")}`, group);
  }
  if (missing.length > 0) {
    const [created] = await pool.query(`SELECT id, name FROM ${table} WHERE name IN (?)`, [missing]);
    for (const row of created) map.set(row.name.toLowerCase(), row.id);
  }

  return map;
}

function autoSku(articleNumber, color, size, index) {
  const parts = [articleNumber, color, size].filter(Boolean);
  return (parts.length > 1 ? parts.join("-") : `${articleNumber}-${index + 1}`).toUpperCase();
}

export async function importProductsCsv(buffer) {
  const records = parse(buffer, {
    columns: (headers) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  const errors = [];
  const productsByArticle = new Map();

  records.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for 1-index, +1 for header row
    const articleNumber = row.articleNumber?.trim();
    const name = row.name?.trim();
    const basePrice = toNumberOrNull(row.basePrice);
    const supplier = row.supplier?.trim();

    if (!articleNumber || !name || basePrice === null || !supplier) {
      if (errors.length < 50) {
        errors.push(`Rad ${rowNumber}: articleNumber, name, basePrice och supplier krävs`);
      }
      return;
    }

    if (!productsByArticle.has(articleNumber)) {
      productsByArticle.set(articleNumber, {
        articleNumber,
        name,
        category: row.category?.trim() || null,
        brand: row.brand?.trim() || null,
        supplier,
        basePrice,
        costPrice: toNumberOrNull(row.costPrice),
        printable: toBool(row.printable),
        variants: [],
      });
    }

    productsByArticle.get(articleNumber).variants.push({
      color: row.color?.trim() || null,
      size: row.size?.trim() || null,
      sku: row.sku?.trim() || null,
      barcode: row.barcode?.trim() || null,
    });
  });

  const products = [...productsByArticle.values()];
  const categoryMap = await resolveNameToId("product_categories", products.map((p) => p.category));
  const brandMap = await resolveNameToId("brands", products.map((p) => p.brand));
  const supplierMap = await resolveNameToId("suppliers", products.map((p) => p.supplier));

  let productsWritten = 0;
  let variantsWritten = 0;
  const productIdByArticle = new Map();

  for (const batch of chunk(products, BATCH_SIZE)) {
    const values = [];
    const placeholders = batch
      .map((p) => {
        values.push(
          p.articleNumber,
          p.name,
          p.category ? categoryMap.get(p.category.toLowerCase()) ?? null : null,
          p.brand ? brandMap.get(p.brand.toLowerCase()) ?? null : null,
          supplierMap.get(p.supplier.toLowerCase()) ?? null,
          p.printable ? 1 : 0,
          p.basePrice,
          p.costPrice
        );
        return "(?, ?, ?, ?, ?, ?, ?, ?)";
      })
      .join(",");

    await pool.query(
      `INSERT INTO products (article_number, name, category_id, brand_id, supplier_id, printable, base_price, cost_price)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), category_id = VALUES(category_id), brand_id = VALUES(brand_id),
         supplier_id = VALUES(supplier_id), printable = VALUES(printable), base_price = VALUES(base_price), cost_price = VALUES(cost_price)`,
      values
    );
    productsWritten += batch.length;

    const articleNumbers = batch.map((p) => p.articleNumber);
    const [rows] = await pool.query(`SELECT id, article_number FROM products WHERE article_number IN (?)`, [
      articleNumbers,
    ]);
    for (const row of rows) productIdByArticle.set(row.article_number, row.id);
  }

  const allVariants = [];
  for (const product of products) {
    const productId = productIdByArticle.get(product.articleNumber);
    if (!productId) continue;
    product.variants.forEach((variant, index) => {
      allVariants.push({
        productId,
        sku: variant.sku || autoSku(product.articleNumber, variant.color, variant.size, index),
        barcode: variant.barcode,
        color: variant.color,
        size: variant.size,
      });
    });
  }

  for (const batch of chunk(allVariants, BATCH_SIZE)) {
    const values = [];
    const placeholders = batch
      .map((v) => {
        values.push(v.productId, v.sku, v.barcode || null, v.color, v.size);
        return "(?, ?, ?, ?, ?)";
      })
      .join(",");

    try {
      await pool.query(
        `INSERT INTO product_variants (product_id, sku, barcode, color, size)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           barcode = VALUES(barcode), color = VALUES(color), size = VALUES(size)`,
        values
      );
      variantsWritten += batch.length;
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        errors.push(`En sats varianter hoppades över p.g.a. dubblett-streckkod (${err.sqlMessage ?? ""})`);
      } else {
        throw err;
      }
    }
  }

  return {
    rowsRead: records.length,
    productsWritten,
    variantsWritten,
    errors,
  };
}
