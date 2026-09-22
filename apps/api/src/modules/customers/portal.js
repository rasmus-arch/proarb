import * as customers from "./service.js";
import { getSettings } from "../settings/service.js";

// Kept in sync with apps/web/public/js/order-status.js — duplicated rather
// than shared because this page is server-rendered (plain HTML response,
// not a browser ES module) while that file is client-side only.
const ORDER_STATUS_LABELS = {
  NEW: "Order",
  READY_FOR_PICKUP: "Redo för utlämning",
  DELIVERED: "Utlämnad",
  INVOICED: "Fakturerad",
  CANCELLED: "Avbruten",
};
const ORDER_STATUS_COLORS = {
  NEW: { bg: "#f1f5f9", fg: "#475569" },
  READY_FOR_PICKUP: { bg: "#fef3c7", fg: "#b45309" },
  DELIVERED: { bg: "#dcfce7", fg: "#15803d" },
  INVOICED: { bg: "#0f172a", fg: "#fff" },
  CANCELLED: { bg: "#fee2e2", fg: "#dc2626" },
};

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

// Ger en ljus, transparent ton av märkesfärgen till bakgrundstoningen utan
// att behöva känna till exakt vilken hex-färg säljaren valt.
function hexToRgba(hex, alpha) {
  const clean = String(hex ?? "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(15, 23, 42, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
        quantity_on_hand: p.quantity_on_hand,
      });
    }
  }
  return [...map.values()];
}

// NULL/undefined means no stock_levels row exists for this variant yet
// (never adjusted/counted) — treated the same as 0, not "unknown", so a
// customer never sees a stale "in stock" claim for something nobody has
// actually put a number on.
function stockBadgeHtml(quantityOnHand) {
  const inStock = Number(quantityOnHand) > 0;
  return inStock
    ? `<span style="display:inline-block;border-radius:9999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">I lager</span>`
    : `<span style="display:inline-block;border-radius:9999px;background:#f1f5f9;color:#64748b;font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">Beställningsvara</span>`;
}

function imageHtml(imageUrl) {
  return imageUrl
    ? `<img src="/uploads/${imageUrl}" alt="" data-lightbox style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;display:block;flex-shrink:0;cursor:zoom-in;" />`
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

  const settings = await getSettings();
  const showStock = Boolean(settings?.portal_show_stock);
  const brandColor = settings?.brand_color || "#0f172a";
  const sellerName = settings?.seller_name || "ProArb";
  // Samma logga/fallback-mönster som nav.js i själva systemet, så
  // portalen känns som samma varumärke istället för ett anonymt formulär.
  const logoHtml = settings?.seller_logo_path
    ? `<img src="/uploads/${settings.seller_logo_path}" alt="${escapeHtml(sellerName)}" style="height:52px;width:auto;max-width:240px;margin:0 auto;display:block;" />`
    : `<div style="font-size:20px;font-weight:700;color:${brandColor};">${escapeHtml(sellerName)}</div>`;

  const { customer, products: flatProducts, orders, contacts } = result;
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
                ${showStock && p.variants[0] ? `<div style="margin-top:4px;">${stockBadgeHtml(p.variants[0].quantity_on_hand)}</div>` : ""}
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
                ${showStock ? `<td style="padding:4px 8px;">${stockBadgeHtml(v.quantity_on_hand)}</td>` : ""}
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

  const orderRows = (orders ?? [])
    .map((o) => {
      const color = ORDER_STATUS_COLORS[o.status] ?? ORDER_STATUS_COLORS.NEW;
      return `<tr>
          <td style="padding:6px 8px;font-weight:500;">${escapeHtml(o.order_number)}</td>
          <td style="padding:6px 8px;color:#64748b;">${new Date(o.created_at).toLocaleDateString("sv-SE")}</td>
          <td style="padding:6px 8px;text-align:right;">
            <span style="display:inline-block;border-radius:9999px;background:${color.bg};color:${color.fg};font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">${ORDER_STATUS_LABELS[o.status] ?? o.status}</span>
          </td>
          <td style="padding:6px 8px;text-align:right;">
            <button type="button" class="reorder-btn" data-order-id="${o.id}" style="background:none;border:1px solid #cbd5e1;border-radius:6px;padding:4px 10px;font-size:12px;color:#334155;cursor:pointer;white-space:nowrap;">Beställ igen</button>
          </td>
        </tr>`;
    })
    .join("");

  res.send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mina sidor – ${escapeHtml(customer.name)}</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: linear-gradient(180deg, ${hexToRgba(brandColor, 0.08)} 0%, #f8fafc 260px);
      color:#0f172a; margin:0; padding:24px 16px;
    }
    .card { max-width: 720px; margin: 0 auto 16px; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:24px; box-shadow: 0 1px 2px rgba(15,23,42,0.03), 0 4px 16px rgba(15,23,42,0.04); }
    .empty { color:#64748b; font-size:14px; margin-top:12px; }
    summary::-webkit-details-marker { display: none; }
    details[open] .chevron { transform: rotate(90deg); }
    .qty-input { border:1px solid #cbd5e1; border-radius:6px; padding:6px 8px; font-size:14px; text-align:right; }
    .qty-input:focus { outline:2px solid ${brandColor}; outline-offset:1px; }
    .order-btn { background:${brandColor}; color:#fff; border:none; border-radius:6px; padding:10px 20px; font-size:14px; font-weight:600; cursor:pointer; }
    .order-btn:disabled { background:#94a3b8; cursor:default; }
    .name-input { border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; font-size:14px; width:100%; max-width:280px; box-sizing:border-box; }
    .lightbox-overlay { display:none; position:fixed; inset:0; background:rgba(15,23,42,0.85); z-index:50; align-items:center; justify-content:center; padding:24px; cursor:zoom-out; }
    .lightbox-overlay.open { display:flex; }
    .lightbox-overlay img { max-width:100%; max-height:100%; border-radius:8px; box-shadow:0 20px 50px rgba(0,0,0,0.4); }
    .section-heading { margin:0; font-size:15px; border-left:3px solid ${brandColor}; padding-left:10px; }
  </style>
</head>
<body>
  <div class="card" style="text-align:center;padding:32px 24px 28px;border-top:4px solid ${brandColor};">
    ${logoHtml}
    <p style="color:#94a3b8;margin:10px 0 0;font-size:12px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">Mina sidor</p>
    <h1 style="margin:2px 0 0;font-size:22px;">${escapeHtml(customer.name)}</h1>
  </div>

  ${
    orderRows
      ? `<div class="card">
          <h2 class="section-heading">Dina beställningar</h2>
          <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
            <tbody>${orderRows}</tbody>
          </table>
          <p id="reorder-message" style="display:none;margin:10px 0 0;font-size:13px;"></p>
        </div>`
      : ""
  }

  <div class="card">
    <h2 class="section-heading">Sortiment</h2>
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

            <label style="display:block;font-size:13px;color:#334155;margin:14px 0 6px;">Vem ska hämta ut beställningen?</label>
            <select id="pickup-contact-select" class="name-input">
              <option value="">— Välj —</option>
              ${(contacts ?? [])
                .map(
                  (c) =>
                    `<option value="${c.id}">${escapeHtml(c.name)}${c.can_pickup ? " (hämtbehörig)" : ""}</option>`
                )
                .join("")}
              <option value="__new__">+ Lägg till ny person</option>
            </select>
            <div id="new-contact-wrap" style="display:none;margin-top:8px;gap:8px;">
              <input id="new-contact-name" type="text" class="name-input" placeholder="Namn på ny person" style="flex:1;" />
              <button type="button" id="add-contact-btn" class="order-btn" style="padding:8px 14px;">Lägg till</button>
            </div>
            <p id="contact-error" style="display:none;color:#dc2626;font-size:13px;margin:6px 0 0;"></p>

            <p id="order-error" style="display:none;color:#dc2626;font-size:13px;margin:10px 0 0;"></p>
            <p id="order-success" style="display:none;color:#15803d;font-size:13px;margin:10px 0 0;">Tack! Din beställning är skickad — vi hör av oss.</p>
            <div style="margin-top:12px;">
              <button type="button" id="submit-order-btn" class="order-btn">Skicka beställning</button>
            </div>
          </div>`
        : ""
    }
  </div>

  <div id="lightbox-overlay" class="lightbox-overlay">
    <img id="lightbox-img" src="" alt="" />
  </div>

  <script>
    (function () {
      var btn = document.getElementById("submit-order-btn");
      if (!btn) return;
      var errorEl = document.getElementById("order-error");
      var successEl = document.getElementById("order-success");
      var pickupSelect = document.getElementById("pickup-contact-select");
      var newContactWrap = document.getElementById("new-contact-wrap");
      var newContactName = document.getElementById("new-contact-name");
      var addContactBtn = document.getElementById("add-contact-btn");
      var contactErrorEl = document.getElementById("contact-error");

      pickupSelect.addEventListener("change", function () {
        if (pickupSelect.value === "__new__") {
          newContactWrap.style.display = "flex";
          newContactName.focus();
        } else {
          newContactWrap.style.display = "none";
        }
      });

      addContactBtn.addEventListener("click", function () {
        contactErrorEl.style.display = "none";
        var name = newContactName.value.trim();
        if (!name) {
          contactErrorEl.textContent = "Ange ett namn.";
          contactErrorEl.style.display = "block";
          return;
        }
        addContactBtn.disabled = true;
        fetch(${JSON.stringify(`/api/public/portal/${req.params.token}/contacts`)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (body) { throw new Error(body.error || "Kunde inte lägga till personen"); });
            return res.json();
          })
          .then(function (contact) {
            var option = document.createElement("option");
            option.value = String(contact.id);
            option.textContent = contact.name + " (hämtbehörig)";
            pickupSelect.insertBefore(option, pickupSelect.querySelector('option[value="__new__"]'));
            pickupSelect.value = String(contact.id);
            newContactWrap.style.display = "none";
            newContactName.value = "";
            addContactBtn.disabled = false;
          })
          .catch(function (err) {
            contactErrorEl.textContent = err.message;
            contactErrorEl.style.display = "block";
            addContactBtn.disabled = false;
          });
      });

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
        var pickupValue = pickupSelect.value;
        var referenceContactId = pickupValue && pickupValue !== "__new__" ? Number(pickupValue) : null;
        btn.disabled = true;
        fetch(${JSON.stringify(`/api/public/portal/${req.params.token}/request`)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedByName: document.getElementById("requested-by-name").value || null,
            referenceContactId: referenceContactId,
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
            pickupSelect.value = "";
            newContactWrap.style.display = "none";
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

    (function () {
      var messageEl = document.getElementById("reorder-message");
      document.querySelectorAll(".reorder-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          if (messageEl) {
            messageEl.style.display = "none";
          }
          btn.disabled = true;
          fetch(${JSON.stringify(`/api/public/portal/${req.params.token}/orders/`)} + btn.dataset.orderId + "/reorder", {
            method: "POST",
          })
            .then(function (res) {
              if (!res.ok) return res.json().then(function (body) { throw new Error(body.error || "Kunde inte återbeställa"); });
              return res.json();
            })
            .then(function () {
              if (messageEl) {
                messageEl.textContent = "Tack! Vi har fått din återbeställning och hör av oss.";
                messageEl.style.color = "#15803d";
                messageEl.style.display = "block";
              }
              btn.disabled = false;
            })
            .catch(function (err) {
              if (messageEl) {
                messageEl.textContent = err.message;
                messageEl.style.color = "#dc2626";
                messageEl.style.display = "block";
              }
              btn.disabled = false;
            });
        });
      });
    })();

    (function () {
      var overlay = document.getElementById("lightbox-overlay");
      var img = document.getElementById("lightbox-img");
      document.addEventListener("click", function (e) {
        var target = e.target.closest ? e.target.closest("[data-lightbox]") : null;
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          img.src = target.src;
          overlay.classList.add("open");
          return;
        }
        if (e.target === overlay) overlay.classList.remove("open");
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") overlay.classList.remove("open");
      });
    })();
  </script>
</body>
</html>`);
}
