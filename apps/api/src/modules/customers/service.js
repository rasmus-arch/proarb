import { pool } from "@proarb/db";

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

  return { ...customer, contacts };
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
