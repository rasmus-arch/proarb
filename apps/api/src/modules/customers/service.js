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

export async function getCustomerByPortalToken(token) {
  const [[customer]] = await pool.query(`SELECT * FROM customers WHERE portal_token = ?`, [token]);
  if (!customer) return null;

  const [quotes] = await pool.query(
    `SELECT id, quote_number, status, created_at, public_token FROM quotes
     WHERE customer_id = ? ORDER BY created_at DESC`,
    [customer.id]
  );
  const [orders] = await pool.query(
    `SELECT id, order_number, status, created_at FROM orders
     WHERE customer_id = ? ORDER BY created_at DESC`,
    [customer.id]
  );

  return { customer, quotes, orders };
}
