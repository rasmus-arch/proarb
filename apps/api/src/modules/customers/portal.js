import * as customers from "./service.js";

// Kundportal (Fas 7): a no-login, read-only page reached only by knowing
// the unguessable portal_token — a lightweight substitute for real
// customer accounts. Lists the customer's own offerter/ordrar so they can
// self-serve status/PDF-länkar without calling in. Registered directly on
// the app (GET /portal/:token) since it isn't a JSON API route, same as
// the public quote page.

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

const QUOTE_STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  VIEWED: "Visad",
  ACCEPTED: "Accepterad",
  DECLINED: "Avböjd",
  EXPIRED: "Utgången",
  CONVERTED: "Omvandlad till order",
};

const ORDER_STATUS_LABELS = {
  NEW: "Ny",
  CONFIRMED: "Bekräftad",
  IN_PRODUCTION: "I produktion",
  READY_FOR_PICKUP: "Klar för avhämtning",
  PARTIALLY_DELIVERED: "Delvis levererad",
  DELIVERED: "Levererad",
  INVOICED: "Fakturerad",
  CANCELLED: "Avbruten",
};

function fmtDate(value) {
  return new Date(value).toLocaleDateString("sv-SE");
}

export async function renderPortalPage(req, res) {
  const result = await customers.getCustomerByPortalToken(req.params.token);
  if (!result) {
    res.status(404).send("<h1>Sidan hittades inte</h1>");
    return;
  }

  const { customer, quotes, orders } = result;

  const quoteRows = quotes
    .map(
      (q) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(q.quote_number)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(q.created_at)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><span class="status">${QUOTE_STATUS_LABELS[q.status] ?? q.status}</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;"><a href="/q/${q.public_token}">Visa</a></td>
      </tr>`
    )
    .join("");

  const orderRows = orders
    .map(
      (o) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(o.order_number)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${fmtDate(o.created_at)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;"><span class="status">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span></td>
      </tr>`
    )
    .join("");

  res.send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mina sidor – ${escapeHtml(customer.name)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px 16px; }
    .card { max-width: 720px; margin: 0 auto 16px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:24px; }
    table { width:100%; border-collapse:collapse; margin-top:12px; font-size:14px; }
    th { text-align:left; font-size:12px; color:#64748b; padding:8px 12px; border-bottom:1px solid #cbd5e1; }
    a { color:#1d4ed8; }
    .status { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; background:#e2e8f0; color:#334155; }
    .empty { color:#64748b; font-size:14px; margin-top:12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0;font-size:20px;">Mina sidor</h1>
    <p style="color:#64748b;margin:4px 0 0;">${escapeHtml(customer.name)}</p>
  </div>

  <div class="card">
    <h2 style="margin:0;font-size:15px;">Offerter</h2>
    ${
      quotes.length > 0
        ? `<table><thead><tr><th>Nummer</th><th>Datum</th><th>Status</th><th></th></tr></thead><tbody>${quoteRows}</tbody></table>`
        : `<p class="empty">Inga offerter ännu.</p>`
    }
  </div>

  <div class="card">
    <h2 style="margin:0;font-size:15px;">Ordrar</h2>
    ${
      orders.length > 0
        ? `<table><thead><tr><th>Nummer</th><th>Datum</th><th>Status</th></tr></thead><tbody>${orderRows}</tbody></table>`
        : `<p class="empty">Inga ordrar ännu.</p>`
    }
  </div>
</body>
</html>`);
}
