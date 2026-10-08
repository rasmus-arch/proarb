import { pool } from "../../lib/db.js";
import { lineTotal } from "../../lib/lines.js";
import { getSettings } from "../settings/service.js";
import {
  sendOrderConfirmedEmail,
  sendOrderDeliveredEmail,
  sendRequestReceivedEmail,
} from "../integrations/email.js";

// Statusmejl till kunden: beställning mottagen (Sortilog), orderbekräftelse
// och utlämnad. Var och en går att stänga av under Inställningar →
// Påminnelser. Allt är best-effort — ett mejl som inte går iväg får aldrig
// stoppa själva beställningen/ordern, felet loggas bara.

function lineName(line) {
  const variant = [line.color, line.size].filter(Boolean).join(" / ");
  return [line.product_name, variant].filter(Boolean).join(" – ");
}

function totalIncVat(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l) * (1 + Number(l.tax_rate_percent) / 100), 0);
}

async function run(label, fn) {
  try {
    const result = await fn();
    if (result && !result.ok && result.reason !== "NOT_CONFIGURED" && result.reason !== "NO_RECIPIENT") {
      console.warn(`Statusmejl (${label}) skickades inte: ${result.note ?? result.reason}`);
    }
    return result ?? null;
  } catch (err) {
    console.warn(`Statusmejl (${label}) misslyckades: ${err.message}`);
    return { ok: false, reason: "SEND_FAILED", note: err.message };
  }
}

export async function notifyRequestReceived(requestId) {
  return run("mottagen", async () => {
    const settings = await getSettings();
    if (!settings?.notify_request_received) return null;
    const [[request]] = await pool.query(
      `SELECT por.requester_email, c.name AS customer_name, c.email AS customer_email
       FROM portal_order_requests por JOIN customers c ON c.id = por.customer_id WHERE por.id = ?`,
      [requestId]
    );
    if (!request) return null;
    const [lines] = await pool.query(
      `SELECT porl.*, p.name AS product_name, v.color, v.size
       FROM portal_order_request_lines porl
       JOIN product_variants v ON v.id = porl.product_variant_id
       JOIN products p ON p.id = v.product_id
       WHERE porl.request_id = ?`,
      [requestId]
    );
    return sendRequestReceivedEmail({
      settings,
      to: request.requester_email || request.customer_email,
      customerName: request.customer_name,
      lines: lines.map((l) => ({ name: lineName(l), quantity: l.quantity })),
      totalIncVat: totalIncVat(lines),
    });
  });
}

// order = getOrder(...)-objekt.
export async function notifyOrderConfirmed(order) {
  return run("bekräftad", async () => {
    const settings = await getSettings();
    if (!settings?.notify_order_confirmed || order.is_cash_customer) return null;
    return sendOrderConfirmedEmail({
      settings,
      to: order.notify_email || order.customer_email,
      customerName: order.customer_name,
      orderNumber: order.order_number,
      lines: order.lines.map((l) => ({ name: lineName(l), quantity: l.quantity })),
      totalIncVat: order.totals?.total_inc_vat,
    });
  });
}

export async function notifyOrderDelivered(order, pickedUpBy) {
  return run("utlämnad", async () => {
    const settings = await getSettings();
    if (!settings?.notify_order_delivered || order.is_cash_customer) return null;
    return sendOrderDeliveredEmail({
      settings,
      to: order.notify_email || order.customer_email,
      customerName: order.customer_name,
      orderNumber: order.order_number,
      pickedUpBy,
    });
  });
}
