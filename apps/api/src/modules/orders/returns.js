import { pool } from "../../lib/db.js";
import { getOrder } from "./service.js";
import { recordMovement, DEFAULT_WAREHOUSE_ID } from "../inventory/service.js";
import { createCreditInvoice } from "../integrations/fortnox.js";
import { getSettings } from "../settings/service.js";

// Retur (hel eller delvis) av en redan utlämnad order. Bara DELIVERED/
// INVOICED-ordrar kan returneras — inget har fysiskt lämnat butiken
// innan dess, så det finns inget att kreditera eller lägga tillbaka på
// lagret. Samma "PENDING-rad i invoices, synka med Fortnox efter commit"
// mönster som recordPickup/createSale använder, så en långsam/
// okonfigurerad Fortnox aldrig blockerar själva returregistreringen.

function round2(n) {
  return Math.round(n * 100) / 100;
}

function returnLineTotal(l) {
  const productTotal = Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount_percent) / 100);
  const printTotal =
    l.print_price === null || l.print_price === undefined
      ? 0
      : Number(l.quantity) * Number(l.print_price) * (1 - Number(l.print_discount_percent ?? 0) / 100);
  return productTotal + printTotal;
}

const RETURNABLE_STATUSES = ["DELIVERED", "INVOICED"];

// Each order line's delivered_qty minus whatever's already been returned
// against it — what the UI should cap the return quantity input at.
export async function getReturnableLines(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const [returned] = await pool.query(
    `SELECT orl.order_line_id, SUM(orl.quantity) AS returned_qty
     FROM order_return_lines orl
     JOIN order_returns oret ON oret.id = orl.return_id
     WHERE oret.order_id = ?
     GROUP BY orl.order_line_id`,
    [orderId]
  );
  const returnedByLine = new Map(returned.map((r) => [r.order_line_id, Number(r.returned_qty)]));

  return order.lines.map((l) => ({
    order_line_id: l.id,
    product_name: l.product_name,
    color: l.color,
    size: l.size,
    delivered_qty: Number(l.delivered_qty),
    already_returned_qty: returnedByLine.get(l.id) ?? 0,
    returnable_qty: Number(l.delivered_qty) - (returnedByLine.get(l.id) ?? 0),
  }));
}

export async function listOrderReturns(orderId) {
  const [returns] = await pool.query(
    `SELECT r.*, u.name AS created_by_name FROM order_returns r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.order_id = ? ORDER BY r.created_at DESC`,
    [orderId]
  );
  for (const r of returns) {
    const [lines] = await pool.query(
      `SELECT orl.*, COALESCE(p.name, ol.description) AS product_name, v.color, v.size
       FROM order_return_lines orl
       JOIN order_lines ol ON ol.id = orl.order_line_id
       LEFT JOIN product_variants v ON v.id = ol.product_variant_id
       LEFT JOIN products p ON p.id = v.product_id
       WHERE orl.return_id = ?`,
      [r.id]
    );
    r.lines = lines;
    r.total_credited = round2(
      lines.reduce((sum, l) => sum + returnLineTotal(l) * (1 + Number(l.tax_rate_percent) / 100), 0)
    );
  }
  return returns;
}

export async function createOrderReturn(orderId, { reason, lines }, userId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (!RETURNABLE_STATUSES.includes(order.status)) throw new Error("ORDER_NOT_RETURNABLE");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("INVALID_RETURN");

  const returnable = await getReturnableLines(orderId);
  const returnableById = new Map(returnable.map((l) => [l.order_line_id, l]));
  const orderLinesById = new Map(order.lines.map((l) => [l.id, l]));

  const validatedLines = [];
  for (const line of lines) {
    const quantity = Number(line.quantity);
    if (!(quantity > 0)) continue;
    const cap = returnableById.get(line.orderLineId);
    const orderLine = orderLinesById.get(line.orderLineId);
    if (!cap || !orderLine) throw new Error("INVALID_RETURN");
    if (quantity > cap.returnable_qty) throw new Error("QUANTITY_EXCEEDS_DELIVERED");
    validatedLines.push({ orderLine, quantity });
  }
  if (validatedLines.length === 0) throw new Error("INVALID_RETURN");

  const creditAmountExVat = validatedLines.reduce(
    (sum, { orderLine, quantity }) => sum + returnLineTotal({ ...orderLine, quantity }),
    0
  );
  const creditAmountIncVat = validatedLines.reduce(
    (sum, { orderLine, quantity }) =>
      sum + returnLineTotal({ ...orderLine, quantity }) * (1 + Number(orderLine.tax_rate_percent) / 100),
    0
  );

  const connection = await pool.getConnection();
  let invoiceId;
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO order_returns (order_id, reason, created_by) VALUES (?, ?, ?)`,
      [orderId, reason?.trim() || null, userId]
    );
    const returnId = result.insertId;

    for (const { orderLine, quantity } of validatedLines) {
      await connection.query(
        `INSERT INTO order_return_lines
           (return_id, order_line_id, quantity, unit_price, discount_percent, tax_rate_percent, print_price, print_discount_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          returnId,
          orderLine.id,
          quantity,
          orderLine.unit_price,
          orderLine.discount_percent,
          orderLine.tax_rate_percent,
          orderLine.print_price,
          orderLine.print_discount_percent,
        ]
      );

      // A fritextrad has no product to put back on lagersaldo.
      if (orderLine.product_variant_id) {
        await recordMovement(connection, {
          variantId: orderLine.product_variant_id,
          warehouseId: DEFAULT_WAREHOUSE_ID,
          type: "RETURN",
          quantityDelta: quantity,
          referenceType: "order_return",
          referenceId: returnId,
          userId,
        });
      }
    }

    const [invoiceResult] = await connection.query(
      `INSERT INTO invoices (order_id, type, amount, status) VALUES (?, 'CREDIT_INVOICE', ?, 'PENDING')`,
      [orderId, round2(creditAmountIncVat)]
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
    const [[originalInvoice]] = await pool.query(
      `SELECT external_ref FROM invoices
       WHERE order_id = ? AND type = 'CUSTOMER_INVOICE' AND external_ref IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    const settings = await getSettings();
    const result = await createCreditInvoice({
      settings,
      customerId: order.customer_id,
      lines: validatedLines.map(({ orderLine, quantity }) => ({ ...orderLine, quantity })),
      orderId,
      originalExternalRef: originalInvoice?.external_ref,
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
