import * as customers from "./service.js";

// Kundportal ("Mina sidor", Fas 9): a no-login, read-only page reached only
// by knowing the unguessable portal_token — a lightweight substitute for
// real customer accounts. Originally listed the customer's own
// offerter/ordrar (Fas 7); replaced per explicit request with a curated
// product assortment instead — staff picks which products a given customer
// should see here (see customers/routes.js GET/POST/DELETE
// .../assortment, managed from kund-editor.html), and this page just
// displays that list. No order/quote history shown here anymore.
// Registered directly on the app (GET /portal/:token) since it isn't a
// JSON API route, same as the public quote page.

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function money(value) {
  return `${Number(value).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export async function renderPortalPage(req, res) {
  const result = await customers.getCustomerByPortalToken(req.params.token);
  if (!result) {
    res.status(404).send("<h1>Sidan hittades inte</h1>");
    return;
  }

  const { customer, products } = result;

  const rows = products
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:500;">${escapeHtml(p.name)}</div>
          <div style="color:#64748b;font-size:12px;">${escapeHtml(p.article_number)}</div>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml([p.color, p.size].filter(Boolean).join(" / "))}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${escapeHtml(p.sku)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(p.price_override ?? p.base_price)}</td>
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
    .empty { color:#64748b; font-size:14px; margin-top:12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0;font-size:20px;">Mina sidor</h1>
    <p style="color:#64748b;margin:4px 0 0;">${escapeHtml(customer.name)}</p>
  </div>

  <div class="card">
    <h2 style="margin:0;font-size:15px;">Sortiment</h2>
    <p style="color:#64748b;font-size:13px;margin:4px 0 0;">Priser är exklusive moms.</p>
    ${
      products.length > 0
        ? `<table><thead><tr><th>Produkt</th><th>Färg/Storlek</th><th>SKU</th><th style="text-align:right;">Pris</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="empty">Inget sortiment upplagt ännu — hör av dig så hjälper vi till.</p>`
    }
  </div>
</body>
</html>`);
}
