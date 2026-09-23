import { pool } from "../../lib/db.js";
import { updateOrderStatus, recordPickup } from "./service.js";

const PROARB_HOME = "https://proarb.se";

// Statuses where there's nothing left to do from the QR — re-scanning an
// already-utlämnad ordersedel should just bounce to the public site instead
// of showing an internal page to whoever's holding the paper.
const TERMINAL_STATUSES = ["DELIVERED", "INVOICED", "CANCELLED"];

async function getOrderByToken(token) {
  const [[order]] = await pool.query(
    `SELECT o.id, o.order_number, o.status, c.name AS customer_name
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.pickup_qr_token = ?`,
    [token]
  );
  return order ?? null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STATUS_LABELS = {
  NEW: "Ny",
  READY_FOR_PICKUP: "Redo för utlämning",
};

// Deliberately bare: no login, no nav, no order details beyond what's
// needed to confirm it's the right ordersedel — just big buttons to move
// the status forward, meant to be scanned and tapped once in the lager,
// not browsed. See PROARB_HOME redirect above/below for what happens once
// there's nothing left to do here.
function renderStatusPage(order, token, { error } = {}) {
  const buttons = [];
  if (order.status === "NEW") {
    buttons.push(`<button class="status-btn ready" data-action="ready">Redo för utlämning</button>`);
  }
  if (["NEW", "READY_FOR_PICKUP"].includes(order.status)) {
    buttons.push(`<button class="status-btn delivered" data-action="delivered">Utlämnad</button>`);
  }

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<title>${escapeHtml(order.order_number)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f172a; color: #f8fafc; text-align: center;
  }
  .order-number { font-size: 1.5rem; font-weight: 700; }
  .customer-name { color: #94a3b8; font-size: 1rem; margin-top: -8px; }
  .status-btn {
    width: 100%; max-width: 360px; padding: 28px 20px; font-size: 1.3rem;
    font-weight: 700; border-radius: 16px; border: none; cursor: pointer;
    color: #fff; -webkit-tap-highlight-color: transparent;
  }
  .status-btn.ready { background: #2563eb; }
  .status-btn.delivered { background: #16a34a; }
  .status-btn:active { opacity: 0.8; }
  .error { color: #fca5a5; font-size: 0.95rem; }
  .done { font-size: 1.2rem; }
</style>
</head>
<body>
  <div class="order-number">${escapeHtml(order.order_number)}</div>
  <div class="customer-name">${escapeHtml(order.customer_name)}</div>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
  ${buttons.join("\n  ")}
  <script>
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".status-btn").forEach((b) => (b.disabled = true));
        try {
          const res = await fetch(window.location.pathname + "/" + btn.dataset.action, { method: "POST" });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || "Något gick fel");
          }
          window.location.reload();
        } catch (err) {
          alert(err.message);
          document.querySelectorAll(".status-btn").forEach((b) => (b.disabled = false));
        }
      });
    });
  </script>
</body>
</html>`;
}

export async function handleQrScan(req, res, next) {
  try {
    const order = await getOrderByToken(req.params.token);
    if (!order) return res.redirect(302, PROARB_HOME);
    if (TERMINAL_STATUSES.includes(order.status)) return res.redirect(302, PROARB_HOME);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStatusPage(order, req.params.token));
  } catch (err) {
    next(err);
  }
}

export async function handleQrMarkReady(req, res, next) {
  try {
    const order = await getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ error: "Ordern hittades inte" });
    await updateOrderStatus(order.id, "READY_FOR_PICKUP");
    res.json({ ok: true });
  } catch (err) {
    if (err.message === "INVALID_TRANSITION") {
      return res.status(409).json({ error: "Ordern kan inte längre markeras som redo" });
    }
    next(err);
  }
}

// Skips the "who picked it up" identity capture the authenticated pickup
// flow (orders/routes.js POST /:id/pickup) normally requires — the whole
// point of the QR flow is a single tap with nothing to fill in. Still goes
// through the real recordPickup (stock deduction + Fortnox-faktura), just
// with a fixed placeholder identity instead of a picked contact/name and no
// verifying user (verified_by_user_id is nullable for exactly this case).
export async function handleQrMarkDelivered(req, res, next) {
  try {
    const order = await getOrderByToken(req.params.token);
    if (!order) return res.status(404).json({ error: "Ordern hittades inte" });
    await recordPickup(order.id, {
      pickedUpByContactId: null,
      pickedUpByName: "Utlämnad via QR-skanning",
      verifiedByUserId: null,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.message === "ORDER_NOT_PICKUPABLE") {
      return res.status(409).json({ error: "Ordern kan inte längre lämnas ut" });
    }
    next(err);
  }
}
