import crypto from "node:crypto";
import { pool } from "../../lib/db.js";

function nextCustomerNumber() {
  // Simple time-based number; good enough until a real sequence/counter
  // table is introduced. Format: K-<unix seconds>.
  return `K-${Math.floor(Date.now() / 1000)}`;
}

export async function listCustomers({ search = "", page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;

  const [rows] = await pool.query(
    `SELECT id, customer_number, name, org_number, email, phone, city, logo_url, active
     FROM customers
     WHERE active = 1 AND (name LIKE ? OR customer_number LIKE ? OR org_number LIKE ?)
     ORDER BY name ASC
     LIMIT ? OFFSET ?`,
    [like, like, like, pageSize, offset]
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM customers
     WHERE active = 1 AND (name LIKE ? OR customer_number LIKE ? OR org_number LIKE ?)`,
    [like, like, like]
  );

  return { rows, total, page, pageSize };
}

export async function getCustomer(id) {
  const [[customer]] = await pool.query(`SELECT * FROM customers WHERE id = ?`, [id]);
  if (!customer) return null;

  const [contacts] = await pool.query(
    `SELECT * FROM customer_contacts WHERE customer_id = ? AND active = 1 ORDER BY name ASC`,
    [id]
  );
  const [logos] = await pool.query(
    `SELECT id, name, file_path, original_filename, mime_type, file_size, created_at
     FROM customer_logos WHERE customer_id = ? ORDER BY created_at DESC`,
    [id]
  );

  return { ...customer, contacts, logos };
}

export async function createCustomer(data) {
  const customerNumber = data.customerNumber?.trim() || nextCustomerNumber();

  const [result] = await pool.query(
    `INSERT INTO customers
       (customer_number, name, org_number, email, phone, address, postal_code, city, logo_url, payment_terms_days, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customerNumber,
      data.name,
      data.orgNumber ?? null,
      data.email ?? null,
      data.phone ?? null,
      data.address ?? null,
      data.postalCode ?? null,
      data.city ?? null,
      data.logoUrl ?? null,
      data.paymentTermsDays ?? 30,
      data.notes ?? null,
    ]
  );

  return getCustomer(result.insertId);
}

export async function updateCustomer(id, data) {
  const fields = {
    name: data.name,
    org_number: data.orgNumber,
    email: data.email,
    phone: data.phone,
    address: data.address,
    postal_code: data.postalCode,
    city: data.city,
    logo_url: data.logoUrl,
    payment_terms_days: data.paymentTermsDays,
    notes: data.notes,
  };

  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getCustomer(id);

  const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
  const values = entries.map(([, value]) => value);

  await pool.query(`UPDATE customers SET ${setClause} WHERE id = ?`, [...values, id]);
  return getCustomer(id);
}

export async function deactivateCustomer(id) {
  await pool.query(`UPDATE customers SET active = 0 WHERE id = ?`, [id]);
}

export async function addContact(customerId, data) {
  const [result] = await pool.query(
    `INSERT INTO customer_contacts (customer_id, name, email, phone, role, can_pickup, pickup_code, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      customerId,
      data.name,
      data.email ?? null,
      data.phone ?? null,
      data.role ?? null,
      data.canPickup ? 1 : 0,
      data.pickupCode ?? null,
      data.notes ?? null,
    ]
  );

  const [[contact]] = await pool.query(`SELECT * FROM customer_contacts WHERE id = ?`, [
    result.insertId,
  ]);
  return contact;
}

export async function updateContact(customerId, contactId, data) {
  const fields = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    role: data.role,
    can_pickup: data.canPickup === undefined ? undefined : data.canPickup ? 1 : 0,
    pickup_code: data.pickupCode,
    notes: data.notes,
  };

  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length > 0) {
    const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await pool.query(`UPDATE customer_contacts SET ${setClause} WHERE id = ? AND customer_id = ?`, [
      ...values,
      contactId,
      customerId,
    ]);
  }

  const [[contact]] = await pool.query(
    `SELECT * FROM customer_contacts WHERE id = ? AND customer_id = ?`,
    [contactId, customerId]
  );
  return contact ?? null;
}

export async function deactivateContact(customerId, contactId) {
  await pool.query(`UPDATE customer_contacts SET active = 0 WHERE id = ? AND customer_id = ?`, [
    contactId,
    customerId,
  ]);
}

// Named logo/print-artwork variants (see PLAN.md §2 kundregister). The
// actual file is handled by multer in routes.js; this just records it.
export async function addLogo(customerId, { name, filePath, originalFilename, mimeType, fileSize, uploadedBy }) {
  const [result] = await pool.query(
    `INSERT INTO customer_logos (customer_id, name, file_path, original_filename, mime_type, file_size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [customerId, name, filePath, originalFilename, mimeType, fileSize, uploadedBy ?? null]
  );
  const [[logo]] = await pool.query(`SELECT * FROM customer_logos WHERE id = ?`, [result.insertId]);
  return logo;
}

export async function getLogo(customerId, logoId) {
  const [[logo]] = await pool.query(`SELECT * FROM customer_logos WHERE id = ? AND customer_id = ?`, [
    logoId,
    customerId,
  ]);
  return logo ?? null;
}

export async function deleteLogo(customerId, logoId) {
  await pool.query(`DELETE FROM customer_logos WHERE id = ? AND customer_id = ?`, [logoId, customerId]);
}

// ---------------------------------------------------------------------
// Kundportal (Fas 7) — no-login, read-only link a staff member generates
// and shares with the customer. Same unguessable-token pattern as the
// public quote link (quotes.public_token).
// ---------------------------------------------------------------------

export async function getOrCreatePortalToken(customerId) {
  const [[row]] = await pool.query(`SELECT portal_token FROM customers WHERE id = ?`, [customerId]);
  if (!row) return null;
  if (row.portal_token) return row.portal_token;

  const token = crypto.randomBytes(24).toString("hex");
  await pool.query(`UPDATE customers SET portal_token = ? WHERE id = ?`, [token, customerId]);
  return token;
}

// Standing discount, when one applies — a rule on this exact product wins
// over a rule on the product's supplier. Shared by getCustomerByPortalToken
// and listAssortment below so both the customer-facing "Mina sidor" page
// and the staff-facing picker in kund-editor.html show the same number.
const ASSORTMENT_DISCOUNT_SELECT = `
  COALESCE(
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND product_id = p.id LIMIT 1),
    (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND supplier_id = p.supplier_id LIMIT 1),
    0
  ) AS discount_percent
`;

// "Mina sidor" (portal.js) shows this customer's curated assortment
// instead of their offert-/orderhistorik — see customer_assortment below.
// One row per variant (color/size), flat, same shape as listProducts;
// portal.js groups rows back into one block per product so a product with
// many variants reads as one product, not N near-identical rows.
export async function getCustomerByPortalToken(token) {
  const [[customer]] = await pool.query(`SELECT * FROM customers WHERE portal_token = ?`, [token]);
  if (!customer) return null;

  const [products] = await pool.query(
    `SELECT p.id AS product_id, p.article_number, p.name, p.base_price, p.image_url,
            v.id AS variant_id, v.sku, v.color, v.size, v.price_override,
            ${ASSORTMENT_DISCOUNT_SELECT}
     FROM customer_assortment ca
     JOIN products p ON p.id = ca.product_id
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = 1
     WHERE ca.customer_id = ? AND p.active = 1
     ORDER BY p.name ASC, v.color ASC, v.size ASC`,
    [customer.id, customer.id, customer.id]
  );

  return { customer, products };
}

// --- Sortiment ("Mina sidor") ----------------------------------------------
// Which products a given customer's portal page is allowed to show. Managed
// from kund-editor.html; rendered read-only on the public /portal/:token
// page (customers/portal.js).

export async function listAssortment(customerId) {
  const [rows] = await pool.query(
    `SELECT ca.id, p.id AS product_id, p.article_number, p.name, p.base_price,
            COUNT(v.id) AS variant_count,
            ${ASSORTMENT_DISCOUNT_SELECT}
     FROM customer_assortment ca
     JOIN products p ON p.id = ca.product_id
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = 1
     WHERE ca.customer_id = ?
     GROUP BY ca.id, p.id, p.article_number, p.name, p.base_price, p.supplier_id
     ORDER BY p.name ASC`,
    [customerId, customerId, customerId]
  );
  return rows;
}

export async function addToAssortment(customerId, productId) {
  await pool.query(`INSERT IGNORE INTO customer_assortment (customer_id, product_id) VALUES (?, ?)`, [
    customerId,
    productId,
  ]);
  return listAssortment(customerId);
}

export async function removeFromAssortment(customerId, productId) {
  await pool.query(`DELETE FROM customer_assortment WHERE customer_id = ? AND product_id = ?`, [
    customerId,
    productId,
  ]);
}

// --- Stående kundrabatter --------------------------------------------------
// En rad är antingen en leverantörsrabatt (supplier_id satt) eller en
// produktrabatt (product_id satt), aldrig båda. Produktregeln vinner om en
// kund har båda på samma produkt — se products/service.js där
// suggested_discount_percent räknas ut (mest specifika COALESCE-träffen
// vinner). Rabatten är bara ett förval när en rad läggs till i
// offert/order/kassa — går fortfarande att skriva över per rad precis som
// idag.

export async function listDiscounts(customerId) {
  const [rows] = await pool.query(
    `SELECT cd.*, s.name AS supplier_name, p.name AS product_name, p.article_number
     FROM customer_discounts cd
     LEFT JOIN suppliers s ON s.id = cd.supplier_id
     LEFT JOIN products p ON p.id = cd.product_id
     WHERE cd.customer_id = ?
     ORDER BY cd.created_at DESC`,
    [customerId]
  );
  return rows;
}

export async function addDiscount(customerId, { supplierId, productId, discountPercent }) {
  if (!supplierId && !productId) throw new Error("DISCOUNT_TARGET_REQUIRED");
  if (supplierId && productId) throw new Error("DISCOUNT_TARGET_AMBIGUOUS");
  const percent = Number(discountPercent);
  if (!(percent > 0) || percent > 100) throw new Error("INVALID_DISCOUNT_PERCENT");

  const [result] = await pool.query(
    `INSERT INTO customer_discounts (customer_id, supplier_id, product_id, discount_percent) VALUES (?, ?, ?, ?)`,
    [customerId, supplierId ?? null, productId ?? null, percent]
  );
  const [[row]] = await pool.query(
    `SELECT cd.*, s.name AS supplier_name, p.name AS product_name, p.article_number
     FROM customer_discounts cd
     LEFT JOIN suppliers s ON s.id = cd.supplier_id
     LEFT JOIN products p ON p.id = cd.product_id
     WHERE cd.id = ?`,
    [result.insertId]
  );
  return row;
}

export async function removeDiscount(customerId, discountId) {
  await pool.query(`DELETE FROM customer_discounts WHERE id = ? AND customer_id = ?`, [discountId, customerId]);
}
