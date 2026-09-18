import { pool } from "../../lib/db.js";
import { updateOrderStatus } from "./service.js";

const PROARB_HOME = "https://proarb.se";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// No login — reached only via the unguessable pickup_qr_token printed on
// the ordersedel PDF (see orders/pdf.js). By design it can do exactly one
// thing: move an order NEW -> READY_FOR_PICKUP. The moment that's true
// (whether this scan caused it or a staff member clicked the button in the
// app first), the token is dead and every future scan of the same paper
// just bounces to proarb.se — never a 404/error page that would invite
// poking at the URL.
export async function handleQrScan(req, res, next) {
  try {
    const [[order]] = await pool.query(`SELECT id, status, order_number FROM orders WHERE pickup_qr_token = ?`, [
      req.params.token,
    ]);

    if (!order || order.status !== "NEW") {
      return res.redirect(302, PROARB_HOME);
    }

    const updated = await updateOrderStatus(order.id, "READY_FOR_PICKUP", { sendEmail: true });

    res.send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order redo</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px 16px; display:flex; min-height:100vh; align-items:center; justify-content:center; }
    .card { max-width: 360px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:28px; text-align:center; }
    .check { font-size:40px; line-height:1; margin-bottom:8px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1 style="margin:0;font-size:17px;">Order ${escapeHtml(updated.order_number)}</h1>
    <p style="color:#64748b;margin-top:8px;">är nu markerad som redo för uthämtning.</p>
  </div>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
}
