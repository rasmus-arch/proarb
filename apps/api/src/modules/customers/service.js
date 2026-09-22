import crypto from "node:crypto";
import { pool } from "../../lib/db.js";
import { DEFAULT_WAREHOUSE_ID } from "../inventory/service.js";

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

// Quick "customer 360" context for staff opening the card — cheap to
// compute (aggregates over this one customer's own rows) so it's always
// included rather than a separate on-demand call.
async function getCustomerStats(id) {
  const [[totals]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED' THEN
         ol.quantity * ol.unit_price * (1 - ol.discount_percent / 100)
         + IFNULL(ol.quantity * ol.print_price * (1 - ol.print_discount_percent / 100), 0)
       ELSE 0 END), 0) AS total_purchased_all_time,
       COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED' AND YEAR(o.created_at) = YEAR(CURDATE()) THEN
         ol.quantity * ol.unit_price * (1 - ol.discount_percent / 100)
         + IFNULL(ol.quantity * ol.print_price * (1 - ol.print_discount_percent / 100), 0)
       ELSE 0 END), 0) AS total_purchased_this_year,
       MAX(CASE WHEN o.status <> 'CANCELLED' THEN o.created_at ELSE NULL END) AS last_order_at
     FROM orders o
     LEFT JOIN order_lines ol ON ol.order_id = o.id
     WHERE o.customer_id = ?`,
    [id]
  );

  const [[{ pending_quotes }]] = await pool.query(
    `SELECT COUNT(*) AS pending_quotes FROM quotes WHERE customer_id = ? AND status IN ('DRAFT', 'SENT', 'VIEWED')`,
    [id]
  );

  return { ...totals, pending_quotes };
}

// Customers who HAVE ordered before but have gone quiet — a cold-lead
// list to prompt a check-in call, not "customers we've never sold to"
// (a brand-new lead with zero orders isn't a churn risk).
export async function listInactiveCustomers(months) {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, MAX(o.created_at) AS last_order_at
     FROM customers c
     JOIN orders o ON o.customer_id = c.id AND o.status <> 'CANCELLED'
     WHERE c.active = 1
     GROUP BY c.id
     HAVING last_order_at < DATE_SUB(NOW(), INTERVAL ? MONTH)
     ORDER BY last_order_at ASC`,
    [months]
  );
  return rows;
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
  const stats = await getCustomerStats(id);

  return { ...customer, contacts, logos, stats };
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
export const ASSORTMENT_DISCOUNT_SELECT = `
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

  // quantity_on_hand is only ever shown when Inställningar → Kundportal
  // turns it on (see portal.js) — fetched unconditionally here since it's
  // cheap and the caller decides whether to render it.
  const [products] = await pool.query(
    `SELECT p.id AS product_id, p.article_number, p.name, p.base_price, p.image_url,
            v.id AS variant_id, v.sku, v.color, v.size, v.price_override,
            sl.quantity_on_hand,
            ${ASSORTMENT_DISCOUNT_SELECT}
     FROM customer_assortment ca
     JOIN products p ON p.id = ca.product_id
     LEFT JOIN product_variants v ON v.product_id = p.id AND v.active = 1
     LEFT JOIN stock_levels sl ON sl.product_variant_id = v.id AND sl.warehouse_id = ?
     WHERE ca.customer_id = ? AND p.active = 1
     ORDER BY p.name ASC, v.color ASC, v.size ASC`,
    [customer.id, customer.id, DEFAULT_WAREHOUSE_ID, customer.id]
  );

  const [orders] = await pool.query(
    `SELECT id, order_number, status, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 10`,
    [customer.id]
  );

  // Samma "anställda/hämtbehörighet"-lista som kund-editor.html visar för
  // personal — kunden väljer bland dem (eller lägger till en ny) för vem
  // som ska hämta ut beställningen, se createPortalOrderRequest.
  const [contacts] = await pool.query(
    `SELECT id, name, can_pickup FROM customer_contacts WHERE customer_id = ? AND active = 1 ORDER BY name ASC`,
    [customer.id]
  );

  return { customer, products, orders, contacts };
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

// --- Anställda & storlekar -------------------------------------------------
// Personalförteckning per kund (skiljer sig från customer_contacts, se
// schema.sql) med sparade storlekar per plagg, så en ny order kan fyllas i
// utifrån "samma som förra året" istället för att fråga kunden på nytt.

export async function listEmployees(customerId) {
  const [employees] = await pool.query(
    `SELECT * FROM customer_employees WHERE customer_id = ? AND active = 1 ORDER BY name ASC`,
    [customerId]
  );
  if (employees.length === 0) return [];

  const [sizes] = await pool.query(
    `SELECT ces.id, ces.employee_id, ces.product_id, ces.size, ces.color,
            p.name AS product_name, p.article_number
     FROM customer_employee_sizes ces
     JOIN products p ON p.id = ces.product_id
     WHERE ces.employee_id IN (?)
     ORDER BY p.name ASC`,
    [employees.map((e) => e.id)]
  );
  const sizesByEmployee = new Map();
  for (const s of sizes) {
    if (!sizesByEmployee.has(s.employee_id)) sizesByEmployee.set(s.employee_id, []);
    sizesByEmployee.get(s.employee_id).push(s);
  }
  return employees.map((e) => ({ ...e, sizes: sizesByEmployee.get(e.id) ?? [] }));
}

export async function addEmployee(customerId, data) {
  if (!data?.name?.trim()) throw new Error("NAME_REQUIRED");
  const [result] = await pool.query(
    `INSERT INTO customer_employees (customer_id, name, notes) VALUES (?, ?, ?)`,
    [customerId, data.name.trim(), data.notes ?? null]
  );
  return { id: result.insertId, customer_id: customerId, name: data.name.trim(), notes: data.notes ?? null, active: 1, sizes: [] };
}

export async function updateEmployee(customerId, employeeId, data) {
  const fields = { name: data.name, notes: data.notes };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length > 0) {
    const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await pool.query(`UPDATE customer_employees SET ${setClause} WHERE id = ? AND customer_id = ?`, [
      ...values,
      employeeId,
      customerId,
    ]);
  }
}

export async function deactivateEmployee(customerId, employeeId) {
  await pool.query(`UPDATE customer_employees SET active = 0 WHERE id = ? AND customer_id = ?`, [
    employeeId,
    customerId,
  ]);
}

// En rad per (anställd, produkt) — sätt storleken igen på en produkt som
// redan har en sparad storlek uppdaterar bara den istället för att skapa en
// duplicerad rad (unique key på employee_id+product_id).
export async function setEmployeeSize(customerId, employeeId, { productId, size, color }) {
  const [[employee]] = await pool.query(
    `SELECT id FROM customer_employees WHERE id = ? AND customer_id = ?`,
    [employeeId, customerId]
  );
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (!productId) throw new Error("PRODUCT_REQUIRED");

  await pool.query(
    `INSERT INTO customer_employee_sizes (employee_id, product_id, size, color)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE size = VALUES(size), color = VALUES(color)`,
    [employeeId, productId, size ?? null, color ?? null]
  );

  const [[row]] = await pool.query(
    `SELECT ces.id, ces.employee_id, ces.product_id, ces.size, ces.color, p.name AS product_name, p.article_number
     FROM customer_employee_sizes ces JOIN products p ON p.id = ces.product_id
     WHERE ces.employee_id = ? AND ces.product_id = ?`,
    [employeeId, productId]
  );
  return row;
}

export async function removeEmployeeSize(customerId, employeeId, sizeId) {
  await pool.query(
    `DELETE ces FROM customer_employee_sizes ces
     JOIN customer_employees ce ON ce.id = ces.employee_id
     WHERE ces.id = ? AND ces.employee_id = ? AND ce.customer_id = ?`,
    [sizeId, employeeId, customerId]
  );
}

// Matchar en anställds sparade storlekar mot en faktisk aktiv variant just
// nu (storleken sparas som fritext, se schema.sql) — samma radform som
// products/service.js searchVariants/kits.js getKit så frontendens
// "variant -> radobjekt"-mappning funkar oförändrad. En sparad storlek utan
// någon matchande aktiv variant (t.ex. utgången storlek) kommer tillbaka i
// unmatched istället för att tystas ner, så säljaren ser att den behöver
// läggas till för hand.
export async function resolveEmployeeOrderLines(customerId, employeeId) {
  const [[employee]] = await pool.query(
    `SELECT id, name FROM customer_employees WHERE id = ? AND customer_id = ?`,
    [employeeId, customerId]
  );
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");

  const [sizes] = await pool.query(
    `SELECT ces.id AS size_id, ces.product_id, ces.size, ces.color,
            p.name AS product_name, p.tax_rate_percent, p.cost_price, p.supplier_id, p.base_price,
            COALESCE(
              (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND product_id = p.id LIMIT 1),
              (SELECT discount_percent FROM customer_discounts WHERE customer_id = ? AND supplier_id = p.supplier_id LIMIT 1),
              0
            ) AS suggested_discount_percent
     FROM customer_employee_sizes ces
     JOIN products p ON p.id = ces.product_id
     WHERE ces.employee_id = ?
     ORDER BY p.name ASC`,
    [customerId, customerId, employeeId]
  );
  if (sizes.length === 0) return { employee, lines: [], unmatched: [] };

  const productIds = [...new Set(sizes.map((s) => s.product_id))];
  const [variants] = await pool.query(
    `SELECT id AS variant_id, product_id, sku, barcode, color, size, price_override
     FROM product_variants WHERE product_id IN (?) AND active = 1`,
    [productIds]
  );

  const lines = [];
  const unmatched = [];
  for (const s of sizes) {
    const candidates = variants.filter((v) => v.product_id === s.product_id);
    const match =
      candidates.find((v) => (!s.size || v.size === s.size) && (!s.color || v.color === s.color)) ??
      (s.size ? candidates.find((v) => v.size === s.size) : null);
    if (!match) {
      unmatched.push({ size_id: s.size_id, product_name: s.product_name, size: s.size, color: s.color });
      continue;
    }
    lines.push({
      variant_id: match.variant_id,
      name: s.product_name,
      color: match.color,
      size: match.size,
      sku: match.sku,
      price_override: match.price_override,
      base_price: s.base_price,
      cost_price: s.cost_price,
      tax_rate_percent: s.tax_rate_percent,
      suggested_discount_percent: Number(s.suggested_discount_percent),
    });
  }
  return { employee, lines, unmatched };
}
