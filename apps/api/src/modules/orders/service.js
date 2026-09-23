import crypto from "node:crypto";
import { pool } from "../../lib/db.js";
import { getQuote } from "../quotes/service.js";
import { recordMovement, DEFAULT_WAREHOUSE_ID } from "../inventory/service.js";
import { assertValidLines } from "../../lib/lines.js";
import { createCustomerInvoice, sendCustomerInvoice } from "../integrations/fortnox.js";
import { sendOrderReadyEmail } from "../integrations/email.js";
import { getSettings } from "../settings/service.js";

// Sekventiella ordernummer (ORD-0001, ORD-0002, ...) istället för
// slumpmässiga tidsstämplar. Läses och räknas upp inom SAMMA transaktion
// som ordern skapas i (connection, inte pool) — UPDATE-radlåset på
// app_settings förhindrar att två samtidiga ordrar får samma nummer, utan
// att behöva någon separat lås-mekanism. Nästa nummer att använda kan
// ändras i Inställningar (t.ex. vid byte från ett annat system).
async function nextOrderNumber(connection) {
  await connection.query(`UPDATE app_settings SET next_order_number = next_order_number + 1 WHERE id = 1`);
  const [[{ next_order_number }]] = await connection.query(
    `SELECT next_order_number FROM app_settings WHERE id = 1`
  );
  return `ORD-${String(next_order_number - 1).padStart(4, "0")}`;
}

// Unguessable token for the QR code on the ordersedel PDF — same pattern
// as customers.portal_token. Generated for every new order so the PDF can
// always print a working QR (updateOrderStatus/getOrder don't need to know
// about it at all; it's only ever read/consumed via qr-public.js).
function generateQrToken() {
  return crypto.randomBytes(24).toString("hex");
}

// unit_price * quantity * (1 - discount%), plus the same for tryck (if
// print_price is set — tryck is optional per line, quantity always
// follows the line's own quantity, no separate tryckantal).
function lineTotal(line) {
  const productTotal = Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
  const printTotal =
    line.print_price === null || line.print_price === undefined
      ? 0
      : Number(line.quantity) * Number(line.print_price) * (1 - Number(line.print_discount_percent ?? 0) / 100);
  return productTotal + printTotal;
}

// null when the product has no cost_price set — margin for that line is
// simply unknown, not zero.
function lineMargin(line, total) {
  if (line.cost_price === null || line.cost_price === undefined) return null;
  return total - Number(line.quantity) * Number(line.cost_price);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function summarizeTotals(lines) {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.tax_rate_percent) / 100), 0);
  const margins = lines.map((l) => lineMargin(l, lineTotal(l))).filter((m) => m !== null);
  const marginAmount = margins.reduce((sum, m) => sum + m, 0);

  return {
    subtotal_ex_vat: round2(subtotal),
    vat_amount: round2(vat),
    total_inc_vat: round2(subtotal + vat),
    margin_amount: round2(marginAmount),
    margin_percent: subtotal > 0 ? round2((marginAmount / subtotal) * 100) : 0,
    margin_incomplete: margins.length < lines.length,
  };
}

// Order (NEW) -> Redo för utlämning -> Utlämnad -> Fakturerad, plus
// Avbruten. DELIVERED is reached only through recordPickup (below) so
// "who picked it up" is always on record — never set manually.
const ALLOWED_TRANSITIONS = {
  NEW: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["CANCELLED"],
  DELIVERED: ["INVOICED"],
  INVOICED: [],
  CANCELLED: [],
};

// Pickup is allowed any time before the order is delivered/closed out —
// small-shop staff often skip the intermediate statuses.
const PICKUP_BLOCKED_STATUSES = ["DELIVERED", "CANCELLED", "INVOICED"];

export async function listOrders({ search = "", status = "", page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;
  const statusClause = status ? "AND o.status = ?" : "";
  const params = status ? [like, like, status, pageSize, offset] : [like, like, pageSize, offset];
  const countParams = status ? [like, like, status] : [like, like];

  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.delivery_method, o.created_at,
            c.id AS customer_id, c.name AS customer_name,
            COALESCE(SUM(
              ol.quantity * ol.unit_price * (1 - ol.discount_percent / 100)
              + IFNULL(ol.quantity * ol.print_price * (1 - ol.print_discount_percent / 100), 0)
            ), 0) AS total_amount
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN order_lines ol ON ol.order_id = o.id
     WHERE (o.order_number LIKE ? OR c.name LIKE ?) ${statusClause}
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE (o.order_number LIKE ? OR c.name LIKE ?) ${statusClause}`,
    countParams
  );

  return { rows, total, page, pageSize };
}

async function loadOrderLines(orderId) {
  // LEFT JOIN: a fritextrad (free-text line) has no product_variant_id, so
  // p/v come back all-NULL for it — COALESCE falls back to the line's own
  // description/tax_rate_percent in that case.
  const [lines] = await pool.query(
    `SELECT ol.*, COALESCE(p.name, ol.description) AS product_name,
            COALESCE(p.tax_rate_percent, ol.tax_rate_percent) AS tax_rate_percent,
            p.cost_price, v.sku, v.color, v.size
     FROM order_lines ol
     LEFT JOIN product_variants v ON v.id = ol.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE ol.order_id = ?
     ORDER BY ol.sort_order ASC, ol.id ASC`,
    [orderId]
  );
  return lines.map((line) => {
    const total = lineTotal(line);
    return { ...line, line_total: total, line_margin: lineMargin(line, total) };
  });
}

export async function getOrder(id) {
  const [[order]] = await pool.query(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email, c.address AS customer_address,
            c.postal_code AS customer_postal_code, c.city AS customer_city, cc.name AS reference_name,
            u.name AS created_by_name
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_contacts cc ON cc.id = o.reference_contact_id
     LEFT JOIN users u ON u.id = o.created_by
     WHERE o.id = ?`,
    [id]
  );
  if (!order) return null;

  const lines = await loadOrderLines(id);
  const [pickups] = await pool.query(
    `SELECT op.*, cc.name AS picked_up_by_contact_name
     FROM order_pickups op
     LEFT JOIN customer_contacts cc ON cc.id = op.picked_up_by_contact_id
     WHERE op.order_id = ? ORDER BY op.picked_up_at ASC`,
    [id]
  );
  const [[{ has_returns }]] = await pool.query(
    `SELECT COUNT(*) AS has_returns FROM order_returns WHERE order_id = ?`,
    [id]
  );

  return {
    ...order,
    lines,
    pickups,
    has_returns: has_returns > 0,
    totals: summarizeTotals(lines),
    can_pickup: !PICKUP_BLOCKED_STATUSES.includes(order.status),
    allowed_next_statuses: ALLOWED_TRANSITIONS[order.status] ?? [],
  };
}

async function insertOrderLines(connection, orderId, lines) {
  let sortOrder = 0;
  for (const line of lines) {
    await connection.query(
      `INSERT INTO order_lines
         (order_id, product_variant_id, description, quantity, unit_price, discount_percent, tax_rate_percent, print_description, print_price, print_discount_percent, sort_order, sourcing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        line.productVariantId ?? line.product_variant_id ?? null,
        line.description ?? null,
        line.quantity,
        line.unitPrice ?? line.unit_price,
        line.discountPercent ?? line.discount_percent ?? 0,
        line.taxRatePercent ?? line.tax_rate_percent ?? null,
        line.printDescription ?? line.print_description ?? null,
        line.printPrice ?? line.print_price ?? null,
        line.printDiscountPercent ?? line.print_discount_percent ?? 0,
        sortOrder++,
        line.sourcing ?? "STOCK",
      ]
    );
  }
}

// Direct order creation ("lägg en order direkt", without going via an
// offert first).
export async function createOrder(data, userId) {
  if (!data.customerId || !Array.isArray(data.lines) || data.lines.length === 0) {
    throw new Error("INVALID_ORDER");
  }
  assertValidLines(data.lines);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const orderNumber = await nextOrderNumber(connection);
    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, delivery_method, notes, created_by, pickup_qr_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        data.customerId,
        data.referenceContactId ?? null,
        data.deliveryMethod ?? "PICKUP",
        data.notes ?? null,
        userId,
        generateQrToken(),
      ]
    );
    const orderId = result.insertId;
    await insertOrderLines(connection, orderId, data.lines);

    await connection.commit();
    return getOrder(orderId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// "Duplicera" — a fresh order (status NEW) with the same customer/
// referens/leveranssätt/rader/anteckningar. New order_number, not linked
// to any quote_id, no pickups/status history carried over.
export async function duplicateOrder(id, userId) {
  const order = await getOrder(id);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const orderNumber = await nextOrderNumber(connection);
    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, delivery_method, notes, created_by, pickup_qr_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        order.customer_id,
        order.reference_contact_id,
        order.delivery_method,
        order.notes,
        userId,
        generateQrToken(),
      ]
    );
    const orderId = result.insertId;
    await insertOrderLines(connection, orderId, order.lines);

    await connection.commit();
    return getOrder(orderId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function convertQuoteToOrder(quoteId, userId) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (quote.status === "CONVERTED") throw new Error("QUOTE_ALREADY_CONVERTED");
  if (quote.status !== "ACCEPTED") throw new Error("QUOTE_NOT_ACCEPTED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const orderNumber = await nextOrderNumber(connection);
    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, quote_id, created_by, pickup_qr_token)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderNumber, quote.customer_id, quote.reference_contact_id, quote.id, userId, generateQrToken()]
    );
    const orderId = result.insertId;
    await insertOrderLines(connection, orderId, quote.lines);

    await connection.query(`UPDATE quotes SET status = 'CONVERTED' WHERE id = ?`, [quote.id]);

    await connection.commit();
    return getOrder(orderId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Låter personal justera en redan sparad orders rader (t.ex. dra ner
// antalet på en restnoterad produkt vid plockning) — bara tillåtet innan
// PICKUP_BLOCKED_STATUSES nedan har hunnit få stopp, samma gräns som redan
// styr recordPickup, eftersom lagerrörelser och ev. Fortnox-faktura byggs
// på radernas belopp först vid DELIVERED. Full-replace, samma resonemang
// som quotes.updateQuote: enklare och säkrare än att diffa mot befintliga
// rader.
export async function updateOrderLines(id, lines) {
  const order = await getOrder(id);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (PICKUP_BLOCKED_STATUSES.includes(order.status)) throw new Error("ORDER_LINES_LOCKED");
  assertValidLines(lines);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM order_lines WHERE order_id = ?`, [id]);
    await insertOrderLines(connection, id, lines);
    await connection.commit();
    return getOrder(id);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// notification is best-effort and never blocks the status change itself
// (same "never let an unconfigured/slow integration undo real work"
// principle as the Fortnox sync in pos/service.js): { sent: true } once a
// real provider exists, or { sent: false, reason } today while
// email.js/fortnox.js are still stubs.
export async function updateOrderStatus(id, newStatus, { sendEmail = false } = {}) {
  const order = await getOrder(id);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error("INVALID_TRANSITION");
  }

  await pool.query(`UPDATE orders SET status = ? WHERE id = ?`, [newStatus, id]);

  let notification = null;
  if (newStatus === "READY_FOR_PICKUP" && sendEmail) {
    try {
      const settings = await getSettings();
      const result = await sendOrderReadyEmail({
        settings,
        to: order.customer_email,
        customerName: order.customer_name,
        orderNumber: order.order_number,
      });
      notification = result.ok ? { sent: true } : { sent: false, reason: result.note ?? result.reason };
    } catch (err) {
      notification = { sent: false, reason: err.message };
    }
  } else if (newStatus === "INVOICED") {
    notification = await sendOrderInvoiceFromFortnox(id);
  }

  return { ...(await getOrder(id)), notification };
}

// The invoice itself is created (in Fortnox) when the order becomes
// DELIVERED — see recordPickup. Marking an order "Fakturerad" just tells
// Fortnox to actually send that already-created invoice to the customer.
async function sendOrderInvoiceFromFortnox(orderId) {
  const [[invoice]] = await pool.query(
    `SELECT * FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [orderId]
  );
  if (!invoice) return { sent: false, reason: "Ingen faktura hittades för ordern." };

  try {
    const settings = await getSettings();
    const result = await sendCustomerInvoice({
      settings,
      externalRef: invoice.external_ref,
      invoiceNumber: invoice.invoice_number,
    });
    if (result.ok) {
      await pool.query(`UPDATE invoices SET status = 'SYNCED', sent_at = NOW() WHERE id = ?`, [invoice.id]);
      return { sent: true };
    }
    await pool.query(`UPDATE invoices SET status_note = ? WHERE id = ?`, [result.note ?? result.reason, invoice.id]);
    return { sent: false, reason: result.note ?? result.reason };
  } catch (err) {
    await pool.query(`UPDATE invoices SET status = 'FAILED', status_note = ? WHERE id = ?`, [err.message, invoice.id]);
    return { sent: false, reason: err.message };
  }
}

// Registers who picked up the order in-store. Marks every line fully
// delivered and the order DELIVERED — per-line/partial pickup is left for
// a later iteration (the schema already supports it via
// order_lines.delivered_qty). Also creates the customer invoice in
// Fortnox ("när en order blir utlämnad ska en faktura skickas till
// fortnox") — best-effort, same PENDING-row-then-sync-after-commit
// pattern pos/service.js uses so a slow/unconfigured Fortnox never blocks
// the pickup itself. Actually emailing that invoice to the customer
// happens later, when the order is marked "Fakturerad" — see
// sendOrderInvoiceFromFortnox above.
export async function recordPickup(orderId, { pickedUpByContactId, pickedUpByName, verifiedByUserId }) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (PICKUP_BLOCKED_STATUSES.includes(order.status)) throw new Error("ORDER_NOT_PICKUPABLE");
  if (!pickedUpByContactId && !pickedUpByName?.trim()) throw new Error("PICKUP_IDENTITY_REQUIRED");

  const connection = await pool.getConnection();
  let invoiceId;
  try {
    await connection.beginTransaction();

    await connection.query(
      `INSERT INTO order_pickups (order_id, picked_up_by_contact_id, picked_up_by_name, verified_by_user_id)
       VALUES (?, ?, ?, ?)`,
      [orderId, pickedUpByContactId ?? null, pickedUpByName?.trim() || null, verifiedByUserId ?? null]
    );

    await connection.query(`UPDATE order_lines SET delivered_qty = quantity WHERE order_id = ?`, [orderId]);
    await connection.query(`UPDATE orders SET status = 'DELIVERED' WHERE id = ?`, [orderId]);

    for (const line of order.lines) {
      // A fritextrad (free-text line) has no product_variant_id — nothing
      // physical to deduct from lagersaldo.
      if (!line.product_variant_id) continue;
      await recordMovement(connection, {
        variantId: line.product_variant_id,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        type: "SALE_OUT",
        quantityDelta: -Number(line.quantity),
        referenceType: "order",
        referenceId: orderId,
        userId: verifiedByUserId,
      });
    }

    const [invoiceResult] = await connection.query(
      `INSERT INTO invoices (order_id, type, amount, status) VALUES (?, 'CUSTOMER_INVOICE', ?, 'PENDING')`,
      [orderId, order.totals.total_inc_vat]
    );
    invoiceId = invoiceResult.insertId;

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  try {
    const settings = await getSettings();
    const result = await createCustomerInvoice({
      settings,
      customerId: order.customer_id,
      lines: order.lines,
      orderId,
      orderNumber: order.order_number,
    });
    if (result.ok) {
      await pool.query(`UPDATE invoices SET status = 'SYNCED', external_ref = ?, invoice_number = ? WHERE id = ?`, [
        result.externalRef ?? null,
        result.invoiceNumber ?? null,
        invoiceId,
      ]);
    } else {
      await pool.query(`UPDATE invoices SET status_note = ? WHERE id = ?`, [result.note ?? result.reason, invoiceId]);
    }
  } catch (err) {
    await pool.query(`UPDATE invoices SET status = 'FAILED', status_note = ? WHERE id = ?`, [err.message, invoiceId]);
  }

  return getOrder(orderId);
}
