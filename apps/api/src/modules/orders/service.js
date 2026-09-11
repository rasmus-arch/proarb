import { pool } from "@proarb/db";
import { getQuote } from "../quotes/service.js";
import { recordMovement, DEFAULT_WAREHOUSE_ID } from "../inventory/service.js";

function nextOrderNumber() {
  return `ORD-${Math.floor(Date.now() / 1000)}`;
}

function lineTotal(line) {
  return Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
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

// Fas 3 allowed status transitions. DELIVERED is reached only through
// recordPickup (below) so "who picked it up" is always on record —
// never set manually. PARTIALLY_DELIVERED exists in the schema for a
// future partial-pickup flow; not reachable from the UI yet.
const ALLOWED_TRANSITIONS = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["READY_FOR_PICKUP", "CANCELLED"],
  READY_FOR_PICKUP: ["CANCELLED"],
  DELIVERED: ["INVOICED"],
  PARTIALLY_DELIVERED: ["DELIVERED", "INVOICED"],
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
            COALESCE(SUM(ol.quantity * ol.unit_price * (1 - ol.discount_percent / 100)), 0) AS total_amount
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
  const [lines] = await pool.query(
    `SELECT ol.*, p.name AS product_name, p.tax_rate_percent, p.cost_price, v.sku, v.color, v.size, pm.name AS print_method_name
     FROM order_lines ol
     JOIN product_variants v ON v.id = ol.product_variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN print_methods pm ON pm.id = ol.print_method_id
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
    `SELECT o.*, c.name AS customer_name, c.address AS customer_address, c.postal_code AS customer_postal_code,
            c.city AS customer_city, cc.name AS reference_name, u.name AS created_by_name
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

  return {
    ...order,
    lines,
    pickups,
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
         (order_id, product_variant_id, quantity, unit_price, discount_percent, print_method_id, print_description, sort_order, sourcing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        line.productVariantId ?? line.product_variant_id,
        line.quantity,
        line.unitPrice ?? line.unit_price,
        line.discountPercent ?? line.discount_percent ?? 0,
        line.printMethodId ?? line.print_method_id ?? null,
        line.printDescription ?? line.print_description ?? null,
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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, delivery_method, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nextOrderNumber(),
        data.customerId,
        data.referenceContactId ?? null,
        data.deliveryMethod ?? "PICKUP",
        data.notes ?? null,
        userId,
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

export async function convertQuoteToOrder(quoteId, userId) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (quote.status === "CONVERTED") throw new Error("QUOTE_ALREADY_CONVERTED");
  if (quote.status !== "ACCEPTED") throw new Error("QUOTE_NOT_ACCEPTED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, quote_id, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [nextOrderNumber(), quote.customer_id, quote.reference_contact_id, quote.id, userId]
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

export async function updateOrderStatus(id, newStatus) {
  const order = await getOrder(id);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const allowed = ALLOWED_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error("INVALID_TRANSITION");
  }

  await pool.query(`UPDATE orders SET status = ? WHERE id = ?`, [newStatus, id]);
  return getOrder(id);
}

// Registers who picked up the order in-store. Marks every line fully
// delivered and the order DELIVERED — per-line/partial pickup is left
// for a later iteration (the schema already supports it via
// order_lines.delivered_qty / the PARTIALLY_DELIVERED status).
export async function recordPickup(orderId, { pickedUpByContactId, pickedUpByName, verifiedByUserId }) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (PICKUP_BLOCKED_STATUSES.includes(order.status)) throw new Error("ORDER_NOT_PICKUPABLE");
  if (!pickedUpByContactId && !pickedUpByName?.trim()) throw new Error("PICKUP_IDENTITY_REQUIRED");

  const connection = await pool.getConnection();
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

    await connection.commit();
    return getOrder(orderId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
