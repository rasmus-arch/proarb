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

// Flat rows (one per variant) -> one block per product, so a product with
// many colors/sizes reads as one product with N variants instead of N
// near-identical rows.
function groupByProduct(products) {
  const map = new Map();
  for (const p of products) {
    if (!map.has(p.product_id)) {
      map.set(p.product_id, {
        product_id: p.product_id,
        article_number: p.article_number,
        name: p.name,
        base_price: p.base_price,
        discount_percent: Number(p.discount_percent) || 0,
        variants: [],
      });
    }
    if (p.variant_id) {
      map.get(p.product_id).variants.push({
        variant_id: p.variant_id,
        color: p.color,
        size: p.size,
        sku: p.sku,
        price: p.price_override ?? p.base_price,
      });
    }
  }
  return [...map.values()];
}

function priceHtml(price, discountPercent) {
  if (discountPercent > 0) {
    const discounted = Number(price) * (1 - discountPercent / 100);
    return `<div style="text-align:right;white-space:nowrap;">
        <div style="text-decoration:line-through;color:#94a3b8;font-size:12px;">${money(price)}</div>
        <div style="font-weight:600;">${money(discounted)}
          <span style="display:inline-block;margin-left:4px;border-radius:9999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:600;padding:1px 8px;">-${discountPercent}%</span>
        </div>
      </div>`;
  }
  return `<div style="text-align:right;white-space:nowrap;">${money(price)}</div>`;
}

export async function renderPortalPage(req, res) {
  const result = await customers.getCustomerByPortalToken(req.params.token);
  if (!result) {
    res.status(404).send("<h1>Sidan hittades inte</h1>");
    return;
  }

  const { customer, products: flatProducts } = result;
  const products = groupByProduct(flatProducts);

  const blocks = products
    .map((p) => {
      const variantBadge =
        p.variants.length > 1
          ? `<span style="display:inline-block;margin-left:8px;border-radius:9999px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:500;padding:2px 9px;">Variabel produkt · ${p.variants.length} varianter</span>`
          : "";

      const header = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 0;">
          <div>
            <div style="font-weight:600;">${escapeHtml(p.name)}${variantBadge}</div>
            <div style="color:#64748b;font-size:12px;">${escapeHtml(p.article_number)}</div>
          </div>
          ${p.variants.length <= 1 ? priceHtml(p.variants[0]?.price ?? p.base_price, p.discount_percent) : ""}
        </div>`;

      const variantTable =
        p.variants.length > 1
          ? `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;font-size:13px;">
              <tbody>
                ${p.variants
                  .map(
                    (v) => `
                  <tr>
                    <td style="padding:4px 8px;color:#334155;">${escapeHtml([v.color, v.size].filter(Boolean).join(" / ") || "–")}</td>
                    <td style="padding:4px 8px;color:#94a3b8;">${escapeHtml(v.sku)}</td>
                    <td style="padding:4px 8px;">${priceHtml(v.price, p.discount_percent)}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>`
          : "";

      return `<div style="border-bottom:1px solid #e2e8f0;">${header}${variantTable}</div>`;
    })
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
        ? blocks
        : `<p class="empty">Inget sortiment upplagt ännu — hör av dig så hjälper vi till.</p>`
    }
  </div>
</body>
</html>`);
}
