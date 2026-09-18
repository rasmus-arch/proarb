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
        image_url: p.image_url,
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

function imageHtml(imageUrl) {
  return imageUrl
    ? `<img src="/uploads/${imageUrl}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;display:block;flex-shrink:0;" />`
    : "";
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
      if (p.variants.length <= 1) {
        const variantId = p.variants[0]?.variant_id;
        return `<div style="border-bottom:1px solid #e2e8f0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              ${imageHtml(p.image_url)}
              <div>
                <div style="font-weight:600;">${escapeHtml(p.name)}</div>
                <div style="color:#64748b;font-size:12px;">${escapeHtml(p.article_number)}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              ${priceHtml(p.variants[0]?.price ?? p.base_price, p.discount_percent)}
              ${variantId ? `<input type="number" min="0" step="1" placeholder="Antal" class="qty-input" data-variant-id="${variantId}" style="width:64px;" />` : ""}
            </div>
          </div>
        </div>`;
      }

      // Every variant of a product shares the same discount rule (it's a
      // product/supplier-level rule, never per-variant) — so if the resolved
      // price also happens to match across all variants, showing it once on
      // the summary row instead of repeating it on every line is both
      // correct and less noisy. Only the per-variant table drops the price
      // column in that case; nothing about the discount itself changes.
      const samePrice = p.variants.every((v) => Number(v.price) === Number(p.variants[0].price));

      const variantTable = `<table style="width:100%;border-collapse:collapse;margin:0 0 10px;font-size:13px;">
          <tbody>
            ${p.variants
              .map(
                (v) => `
              <tr>
                <td style="padding:4px 8px;color:#334155;">${escapeHtml([v.color, v.size].filter(Boolean).join(" / ") || "–")}</td>
                <td style="padding:4px 8px;color:#94a3b8;">${escapeHtml(v.sku)}</td>
                ${samePrice ? "" : `<td style="padding:4px 8px;">${priceHtml(v.price, p.discount_percent)}</td>`}
                <td style="padding:4px 8px;text-align:right;"><input type="number" min="0" step="1" placeholder="0" class="qty-input" data-variant-id="${v.variant_id}" style="width:56px;" /></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

      return `<details style="border-bottom:1px solid #e2e8f0;padding:10px 0;">
          <summary style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              ${imageHtml(p.image_url)}
              <span>
                <span class="chevron" style="display:inline-block;margin-right:8px;color:#94a3b8;transition:transform 0.15s;">▸</span>
                <span style="font-weight:600;">${escapeHtml(p.name)}</span>
                <span style="display:inline-block;margin-left:8px;border-radius:9999px;background:#f1f5f9;color:#475569;font-size:11px;font-weight:500;padding:2px 9px;">${p.variants.length} varianter</span>
                <div style="color:#64748b;font-size:12px;margin-top:2px;padding-left:19px;">${escapeHtml(p.article_number)}</div>
              </span>
            </div>
            ${samePrice ? priceHtml(p.variants[0].price, p.discount_percent) : ""}
          </summary>
          <div style="margin-top:8px;">${variantTable}</div>
        </details>`;
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
    summary::-webkit-details-marker { display: none; }
    details[open] .chevron { transform: rotate(90deg); }
    .qty-input { border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; font-size:14px; text-align:right; }
    .qty-input:focus { outline:2px solid #0f172a; outline-offset:1px; }
    .order-btn { background:#0f172a; color:#fff; border:none; border-radius:6px; padding:10px 20px; font-size:14px; font-weight:600; cursor:pointer; }
    .order-btn:disabled { background:#94a3b8; cursor:default; }
    .name-input { border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; font-size:14px; width:100%; max-width:280px; box-sizing:border-box; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0;font-size:20px;">Mina sidor</h1>
    <p style="color:#64748b;margin:4px 0 0;">${escapeHtml(customer.name)}</p>
  </div>

  <div class="card">
    <h2 style="margin:0;font-size:15px;">Sortiment</h2>
    <p style="color:#64748b;font-size:13px;margin:4px 0 0;">Priser är exklusive moms. Ange antal för det du vill beställa nedan.</p>
    ${
      products.length > 0
        ? blocks
        : `<p class="empty">Inget sortiment upplagt ännu — hör av dig så hjälper vi till.</p>`
    }
    ${
      products.length > 0
        ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;">
            <label style="display:block;font-size:13px;color:#334155;margin-bottom:6px;">Ditt namn (valfritt, så vi vet vem beställningen är från)</label>
            <input id="requested-by-name" type="text" class="name-input" placeholder="För- och efternamn" />
            <p id="order-error" style="display:none;color:#dc2626;font-size:13px;margin:10px 0 0;"></p>
            <p id="order-success" style="display:none;color:#15803d;font-size:13px;margin:10px 0 0;">Tack! Din beställning är skickad — vi hör av oss.</p>
            <div style="margin-top:12px;">
              <button type="button" id="submit-order-btn" class="order-btn">Skicka beställning</button>
            </div>
          </div>`
        : ""
    }
  </div>

  <script>
    (function () {
      var btn = document.getElementById("submit-order-btn");
      if (!btn) return;
      var errorEl = document.getElementById("order-error");
      var successEl = document.getElementById("order-success");
      btn.addEventListener("click", function () {
        errorEl.style.display = "none";
        successEl.style.display = "none";
        var lines = [];
        document.querySelectorAll(".qty-input").forEach(function (input) {
          var qty = Number(input.value);
          if (qty > 0) lines.push({ productVariantId: Number(input.dataset.variantId), quantity: qty });
        });
        if (lines.length === 0) {
          errorEl.textContent = "Ange antal för minst en produkt.";
          errorEl.style.display = "block";
          return;
        }
        btn.disabled = true;
        fetch(${JSON.stringify(`/api/public/portal/${req.params.token}/request`)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedByName: document.getElementById("requested-by-name").value || null,
            lines: lines,
          }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (body) { throw new Error(body.error || "Kunde inte skicka beställningen"); });
            return res.json();
          })
          .then(function () {
            document.querySelectorAll(".qty-input").forEach(function (input) { input.value = ""; });
            document.getElementById("requested-by-name").value = "";
            successEl.style.display = "block";
            btn.disabled = false;
          })
          .catch(function (err) {
            errorEl.textContent = err.message;
            errorEl.style.display = "block";
            btn.disabled = false;
          });
      });
    })();
  </script>
</body>
</html>`);
}
