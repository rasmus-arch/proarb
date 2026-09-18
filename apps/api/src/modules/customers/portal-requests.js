import { pool } from "../../lib/db.js";
import { createOrder } from "../orders/service.js";
import { ASSORTMENT_DISCOUNT_SELECT, addContact } from "./service.js";

// Self-service beställning från "Mina sidor" (portal.js): kunden väljer
// antal ur sitt kurerade sortiment och skickar in. Pris/rabatt räknas
// alltid fram här server-side (aldrig från vad klienten skickar in) och
// frysta vid inskick, så en säljare kan lita på att raderna som väntar
// för granskning fortfarande stämmer även om en rabattregel ändras innan
// den hinner konverteras. product_variant_id valideras samtidigt mot
// customer_assortment — kunden kan bara beställa det den faktiskt ser.

export async function createPortalOrderRequest(token, { requestedByName, referenceContactId, lines }) {
  const [[customer]] = await pool.query(`SELECT id FROM customers WHERE portal_token = ?`, [token]);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("INVALID_REQUEST");

  // Måste tillhöra samma kund som token pekar på — annars skulle en kund
  // kunna sätta valfritt contact-id, inklusive en annan kunds kontakt.
  let contactId = null;
  if (referenceContactId) {
    const [[contact]] = await pool.query(
      `SELECT id FROM customer_contacts WHERE id = ? AND customer_id = ? AND active = 1`,
      [referenceContactId, customer.id]
    );
    contactId = contact?.id ?? null;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO portal_order_requests (customer_id, requested_by_name, reference_contact_id) VALUES (?, ?, ?)`,
      [customer.id, requestedByName || null, contactId]
    );
    const requestId = result.insertId;

    let linesInserted = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      if (!(quantity > 0)) continue;

      const [[priced]] = await connection.query(
        `SELECT v.id AS variant_id, v.price_override, p.base_price, p.tax_rate_percent,
                ${ASSORTMENT_DISCOUNT_SELECT}
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         JOIN customer_assortment ca ON ca.product_id = p.id AND ca.customer_id = ?
         WHERE v.id = ? AND v.active = 1 AND p.active = 1`,
        [customer.id, customer.id, customer.id, line.productVariantId]
      );
      // Not in this customer's curated assortment (or not a real/active
      // variant) — silently skipped rather than failing the whole request,
      // same defensive posture as assertValidLines elsewhere: bad input
      // from one line shouldn't block the rest of a genuine order.
      if (!priced) continue;

      await connection.query(
        `INSERT INTO portal_order_request_lines
           (request_id, product_variant_id, quantity, unit_price, discount_percent, tax_rate_percent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          priced.variant_id,
          quantity,
          Number(priced.price_override ?? priced.base_price),
          Number(priced.discount_percent) || 0,
          Number(priced.tax_rate_percent),
        ]
      );
      linesInserted++;
    }

    if (linesInserted === 0) throw new Error("INVALID_REQUEST");

    await connection.commit();
    return { id: requestId };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function listPortalOrderRequests({ status = "NEW" } = {}) {
  const where = status ? "WHERE por.status = ?" : "";
  const params = status ? [status] : [];
  const [rows] = await pool.query(
    `SELECT por.id, por.requested_by_name, por.status, por.created_at, por.order_id,
            c.id AS customer_id, c.name AS customer_name,
            cc.name AS reference_contact_name,
            COUNT(porl.id) AS line_count, SUM(porl.quantity) AS total_quantity
     FROM portal_order_requests por
     JOIN customers c ON c.id = por.customer_id
     LEFT JOIN customer_contacts cc ON cc.id = por.reference_contact_id
     LEFT JOIN portal_order_request_lines porl ON porl.request_id = por.id
     ${where}
     GROUP BY por.id
     ORDER BY por.created_at ASC`,
    params
  );
  return rows;
}

async function getPortalOrderRequest(id) {
  const [[request]] = await pool.query(
    `SELECT por.*, c.name AS customer_name
     FROM portal_order_requests por
     JOIN customers c ON c.id = por.customer_id
     WHERE por.id = ?`,
    [id]
  );
  if (!request) return null;

  const [lines] = await pool.query(
    `SELECT porl.*, p.name AS product_name, v.color, v.size, v.sku
     FROM portal_order_request_lines porl
     JOIN product_variants v ON v.id = porl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE porl.request_id = ?`,
    [id]
  );
  return { ...request, lines };
}

// Blir en riktig order (samma status-flöde/utlämning som alla andra) med
// den inloggade säljaren som created_by — det är därför detta, och inte
// direkt inskick från portalen, är vägen till en verklig order.
export async function convertPortalOrderRequest(id, userId) {
  const request = await getPortalOrderRequest(id);
  if (!request) throw new Error("REQUEST_NOT_FOUND");
  if (request.status !== "NEW") throw new Error("REQUEST_ALREADY_HANDLED");

  const order = await createOrder(
    {
      customerId: request.customer_id,
      referenceContactId: request.reference_contact_id,
      notes: request.requested_by_name
        ? `Beställning via kundportalen (${request.requested_by_name}).`
        : "Beställning via kundportalen.",
      lines: request.lines.map((l) => ({
        productVariantId: l.product_variant_id,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent,
        taxRatePercent: l.tax_rate_percent,
        sourcing: "STOCK",
      })),
    },
    userId
  );

  await pool.query(
    `UPDATE portal_order_requests SET status = 'CONVERTED', order_id = ?, handled_by = ?, handled_at = NOW() WHERE id = ?`,
    [order.id, userId, id]
  );

  return order;
}

// Kunden kan lägga till en ny hämtbehörig kontakt direkt från "Mina
// sidor" (t.ex. en nyanställd som inte redan finns i listan) istället för
// att bara skriva ett fritextnamn — blir en riktig customer_contacts-rad,
// synlig för personal på kund-editor.html och återanvändbar nästa gång.
export async function addPortalContact(token, data) {
  const [[customer]] = await pool.query(`SELECT id FROM customers WHERE portal_token = ?`, [token]);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (!data?.name?.trim()) throw new Error("NAME_REQUIRED");
  return addContact(customer.id, { name: data.name.trim(), canPickup: true });
}

export async function dismissPortalOrderRequest(id, userId) {
  const [result] = await pool.query(
    `UPDATE portal_order_requests SET status = 'DISMISSED', handled_by = ?, handled_at = NOW() WHERE id = ? AND status = 'NEW'`,
    [userId, id]
  );
  if (result.affectedRows === 0) throw new Error("REQUEST_NOT_FOUND");
}
