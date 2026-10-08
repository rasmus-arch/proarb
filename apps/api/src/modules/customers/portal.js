import path from "node:path";
import * as customers from "./service.js";
import { getSettings } from "../settings/service.js";
import { listCustomerInvoices } from "./portal-invoices.js";
import { refreshUnpaidInvoices } from "./payment-status.js";
import { ensurePreviewFile, isPreviewable } from "../../lib/preview.js";

const BROWSER_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg", ".webp"]);

// Kundens egna loggor (kund-editorn → Loggor & tryckunderlag), med en
// visningsbar bild för var och en: bildformat visas som de är, EPS/PDF via
// den PNG-förhandsbild som preview.js skapar (null om filen inte går att
// rendera — då visas bara namnet och nedladdningslänken).
async function portalLogos(customerId) {
  const logos = await customers.listLogos(customerId);
  return Promise.all(
    logos.map(async (logo) => {
      const ext = path.extname(logo.file_path).toLowerCase();
      let displayPath = BROWSER_IMAGE_EXTENSIONS.has(ext) ? logo.file_path : null;
      if (!displayPath && isPreviewable(logo.file_path)) {
        displayPath = await ensurePreviewFile(logo.file_path).catch(() => null);
      }
      return { ...logo, display_url: displayPath ? `/uploads/${displayPath}` : null };
    })
  );
}

// Kept in sync with apps/web/public/js/order-status.js — duplicated rather
// than shared because this page is server-rendered (plain HTML response,
// not a browser ES module) while that file is client-side only.
const ORDER_STATUS_LABELS = {
  NEW: "Bekräftad",
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
        discount_amount: Number(p.discount_amount) || 0,
        tax_rate_percent: Number(p.tax_rate_percent ?? 25),
        print_description: p.print_description,
        print_price: p.print_price === null || p.print_price === undefined ? null : Number(p.print_price),
        print_discount_percent: Number(p.print_discount_percent) || 0,
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
        discontinued: Boolean(p.discontinued),
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

// Utgången produkt: bara det som finns kvar kan beställas.
function discontinuedBadgeHtml(quantity) {
  return `<span style="display:inline-block;border-radius:9999px;background:#fef3c7;color:#b45309;font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">Utgår · ${Math.max(0, Number(quantity) || 0)} kvar</span>`;
}

function imageHtml(imageUrl) {
  return imageUrl
    ? `<img src="/uploads/${imageUrl}" alt="" data-lightbox style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e2e8f0;display:block;flex-shrink:0;cursor:zoom-in;" />`
    : "";
}

// Nettopris per styck efter kundens rabatt (% eller kr/st), samma regel
// som lib/lines.js använder när beställningen blir en order.
function netPrice(price, p) {
  return Math.max(0, Number(price) * (1 - p.discount_percent / 100) - p.discount_amount);
}

function priceHtml(price, p) {
  if (p.discount_percent > 0 || p.discount_amount > 0) {
    const label = p.discount_amount > 0 ? `-${money(p.discount_amount)}/st` : `-${p.discount_percent}%`;
    return `<div style="text-align:right;white-space:nowrap;">
        <div style="text-decoration:line-through;color:#94a3b8;font-size:12px;">${money(price)}</div>
        <div style="font-weight:600;">${money(netPrice(price, p))}
          <span style="display:inline-block;margin-left:4px;border-radius:9999px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:600;padding:1px 8px;">${label}</span>
        </div>
      </div>`;
  }
  return `<div style="text-align:right;white-space:nowrap;">${money(price)}</div>`;
}

// Tryck som kunden har i sitt sortiment (sätts av personalen) — följer med
// beställningen och räknas med i sammanställningen.
function printNetPrice(p) {
  return p.print_price === null ? 0 : p.print_price * (1 - p.print_discount_percent / 100);
}

function printHtml(p) {
  if (p.print_price === null) return "";
  return `<div style="color:#475569;font-size:12px;margin-top:3px;">Tryck: ${escapeHtml(p.print_description || "Tryck")} · ${money(printNetPrice(p))}/st${
    p.print_discount_percent > 0 ? ` <span style="color:#15803d;">(-${p.print_discount_percent}%)</span>` : ""
  }</div>`;
}

// Det sammanställningen behöver per antal-ruta (räknas i webbläsaren;
// priset räknas om på servern vid inskick, se portal-requests.js).
function qtyDataAttrs(p, v) {
  const label = [p.name, [v.color, v.size].filter(Boolean).join(" / ")].filter(Boolean).join(" – ");
  return `data-label="${escapeHtml(label)}" data-unit="${netPrice(v.price, p).toFixed(2)}" data-print-unit="${printNetPrice(p).toFixed(2)}" data-tax="${p.tax_rate_percent}"`;
}

// GET /portal/:token — länken utan inloggning. Stängd när Inställningar →
// Sortilog kräver inloggning; då skickas besökaren till inloggningen.
export async function renderPortalPage(req, res) {
  const settings = await getSettings();
  if (settings?.portal_require_login) {
    res.redirect("/sortilog");
    return;
  }
  return renderPortal(req, res, req.params.token);
}

// Själva Sortilog-sidan, för en kunds portal_token. `account` är det
// inloggade kontot (via /sortilog) eller null (länk utan inloggning).
export async function renderPortal(req, res, token, { account = null } = {}) {
  const result = await customers.getCustomerByPortalToken(token);
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

  const { customer, products: flatProducts, orders, contacts, pendingRequests, costCenters } = result;
  const products = groupByProduct(flatProducts);
  const logos = await portalLogos(customer.id);
  // Första uppladdade loggan som går att visa = kundens "huvudlogga" i sidhuvudet.
  const mainLogo = logos.find((l) => l.display_url);

  const logoCards = logos
    .map(
      (l) => `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px;">
          <div style="height:96px;display:flex;align-items:center;justify-content:center;background:#f8fafc;border-radius:6px;padding:8px;">
            ${
              l.display_url
                ? `<img src="${escapeHtml(l.display_url)}" alt="${escapeHtml(l.name)}" style="max-height:100%;max-width:100%;object-fit:contain;" />`
                : `<span style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;">${escapeHtml(path.extname(l.original_filename).slice(1) || "fil")}</span>`
            }
          </div>
          <div style="font-size:13px;font-weight:600;">${escapeHtml(l.name)}</div>
          <a href="/uploads/${escapeHtml(l.file_path)}" download="${escapeHtml(l.original_filename)}" style="font-size:12px;color:#475569;">Ladda ner (${escapeHtml(path.extname(l.original_filename).slice(1).toUpperCase() || "fil")})</a>
        </div>`
    )
    .join("");

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
                ${printHtml(p)}
                ${p.variants[0]?.discontinued ? `<div style="margin-top:4px;">${discontinuedBadgeHtml(p.variants[0].quantity_on_hand)}</div>` : showStock && p.variants[0] ? `<div style="margin-top:4px;">${stockBadgeHtml(p.variants[0].quantity_on_hand)}</div>` : ""}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              ${priceHtml(p.variants[0]?.price ?? p.base_price, p)}
              ${variantId ? `<input type="number" min="0" step="1" placeholder="Antal" class="qty-input" data-variant-id="${variantId}" ${qtyDataAttrs(p, p.variants[0])} style="width:64px;" />` : ""}
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
                ${v.discontinued ? `<td style="padding:4px 8px;">${discontinuedBadgeHtml(v.quantity_on_hand)}</td>` : showStock ? `<td style="padding:4px 8px;">${stockBadgeHtml(v.quantity_on_hand)}</td>` : ""}
                ${samePrice ? "" : `<td style="padding:4px 8px;">${priceHtml(v.price, p)}</td>`}
                <td style="padding:4px 8px;text-align:right;"><input type="number" min="0" step="1" placeholder="0" class="qty-input" data-variant-id="${v.variant_id}" ${qtyDataAttrs(p, v)} style="width:56px;" /></td>
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
                <div style="padding-left:19px;">${printHtml(p)}</div>
              </span>
            </div>
            ${samePrice ? priceHtml(p.variants[0].price, p) : ""}
          </summary>
          <div style="margin-top:8px;">${variantTable}</div>
        </details>`;
    })
    .join("");

  // Fakturor bara för inloggade (inte via länk utan inloggning).
  let invoiceRows = "";
  if (account) {
    refreshUnpaidInvoices(); // i bakgrunden — status uppdateras till nästa visning
    const invoices = await listCustomerInvoices(customer.id);
    invoiceRows = invoices
      .map((i) => {
        const state = i.type === "CREDIT_INVOICE"
          ? { text: "Kredit", bg: "#f1f5f9", fg: "#475569" }
          : i.paid_at
            ? { text: "Betald", bg: "#dcfce7", fg: "#15803d" }
            : i.overdue
              ? { text: "Förfallen", bg: "#fee2e2", fg: "#dc2626" }
              : { text: "Obetald", bg: "#fef3c7", fg: "#b45309" };
        const amount = Number(i.balance ?? i.amount).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `<tr>
          <td style="padding:6px 8px;font-weight:500;">${escapeHtml(i.invoice_number ?? "")}</td>
          <td style="padding:6px 8px;color:#64748b;">${new Date(i.created_at).toLocaleDateString("sv-SE")}${
            i.due_date && !i.paid_at ? `<div style="font-size:11px;">Förfaller ${escapeHtml(i.due_date)}</div>` : ""
          }</td>
          <td style="padding:6px 8px;color:#64748b;">${escapeHtml(i.order_number ?? "")}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap;">${amount} kr${i.balance !== null && !i.paid_at ? `<div style="font-size:11px;color:#64748b;">kvar att betala</div>` : ""}</td>
          <td style="padding:6px 8px;text-align:right;">
            <span style="display:inline-block;border-radius:9999px;background:${state.bg};color:${state.fg};font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">${state.text}</span>
          </td>
          <td style="padding:6px 8px;text-align:right;"><a href="/sortilog/faktura/${i.id}" target="_blank" rel="noopener" style="font-size:12px;color:#334155;">PDF</a></td>
        </tr>`;
      })
      .join("");
  }

  const pendingRows = (pendingRequests ?? [])
    .map(
      (r) => `<tr>
          <td style="padding:6px 8px;font-weight:500;color:#64748b;">Beställning</td>
          <td style="padding:6px 8px;color:#64748b;">${new Date(r.created_at).toLocaleDateString("sv-SE")}</td>
          <td style="padding:6px 8px;text-align:right;">
            <span style="display:inline-block;border-radius:9999px;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:600;padding:2px 9px;white-space:nowrap;">Mottagen – väntar på bekräftelse</span>
          </td>
          <td></td>
        </tr>`
    )
    .join("");

  const orderRows = pendingRows + (orders ?? [])
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
  <title>Sortilog – ${escapeHtml(customer.name)}</title>
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
    <p style="color:#94a3b8;margin:10px 0 0;font-size:12px;letter-spacing:0.05em;text-transform:uppercase;font-weight:600;">Sortilog</p>
    ${
      mainLogo
        ? `<img src="${escapeHtml(mainLogo.display_url)}" alt="${escapeHtml(customer.name)}" style="display:block;margin:14px auto 6px;max-height:72px;max-width:260px;object-fit:contain;" />`
        : ""
    }
    <h1 style="margin:2px 0 0;font-size:22px;">${escapeHtml(customer.name)}</h1>
    ${
      account
        ? `<form method="post" action="/sortilog/logout" style="margin:12px 0 0;font-size:12px;color:#64748b;">
            Inloggad som ${escapeHtml(account.name || account.email)} ·
            <button type="submit" style="background:none;border:none;padding:0;color:#475569;text-decoration:underline;cursor:pointer;font-size:12px;">Logga ut</button>
          </form>`
        : ""
    }
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

  ${
    invoiceRows
      ? `<div class="card">
          <h2 class="section-heading">Fakturor</h2>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">
              <tbody>${invoiceRows}</tbody>
            </table>
          </div>
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
            <input id="requested-by-name" type="text" class="name-input" placeholder="För- och efternamn" value="${escapeHtml(account?.name ?? "")}" />

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

            <label style="display:block;font-size:13px;color:#334155;margin:14px 0 6px;">E-post till den som hämtar (valfritt)</label>
            <input id="pickup-email" type="email" maxlength="255" class="name-input" placeholder="Hit skickas besked när ordern är redo" />

            <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:14px;">
              <label style="flex:1;min-width:180px;font-size:13px;color:#334155;">Er referens (valfritt)
                <input id="customer-reference" type="text" maxlength="50" class="name-input" style="margin-top:6px;" placeholder="Står på fakturan" />
              </label>
              <label style="flex:1;min-width:180px;font-size:13px;color:#334155;">Kostnadsställe / ert ordernr (valfritt)
                <input id="cost-center" type="text" maxlength="30" class="name-input" style="margin-top:6px;" list="cost-center-options" />
                <datalist id="cost-center-options">${(costCenters ?? []).map((c) => `<option value="${escapeHtml(c)}">`).join("")}</datalist>
              </label>
            </div>

            <div id="order-summary" style="display:none;margin-top:18px;border:1px solid #e2e8f0;border-radius:8px;padding:14px;background:#f8fafc;">
              <div style="font-weight:600;font-size:14px;margin-bottom:8px;">Din beställning</div>
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead>
                  <tr style="color:#64748b;text-align:left;">
                    <th style="padding:4px 6px;font-weight:500;">Produkt</th>
                    <th style="padding:4px 6px;font-weight:500;text-align:right;">Antal</th>
                    <th style="padding:4px 6px;font-weight:500;text-align:right;">à-pris</th>
                    <th style="padding:4px 6px;font-weight:500;text-align:right;">Tryck/st</th>
                    <th style="padding:4px 6px;font-weight:500;text-align:right;">Summa</th>
                  </tr>
                </thead>
                <tbody id="order-summary-rows"></tbody>
              </table>
              <div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:13px;display:grid;grid-template-columns:1fr auto;gap:3px 16px;max-width:320px;margin-left:auto;">
                <span style="color:#64748b;">Produkter</span><span id="sum-products" style="text-align:right;"></span>
                <span style="color:#64748b;">Tryck</span><span id="sum-print" style="text-align:right;"></span>
                <span style="color:#64748b;">Summa ex moms</span><span id="sum-ex" style="text-align:right;"></span>
                <span style="color:#64748b;">Moms</span><span id="sum-vat" style="text-align:right;"></span>
                <span style="font-weight:700;">Totalt inkl moms</span><span id="sum-total" style="text-align:right;font-weight:700;"></span>
              </div>
              <p style="color:#94a3b8;font-size:11px;margin:8px 0 0;">Preliminärt — vi bekräftar beställningen innan den blir en order.</p>
            </div>

            <p id="order-error" style="display:none;color:#dc2626;font-size:13px;margin:10px 0 0;"></p>
            <p id="order-success" style="display:none;color:#15803d;font-size:13px;margin:10px 0 0;">Tack! Din beställning är skickad — vi hör av oss.</p>
            <div style="margin-top:12px;">
              <button type="button" id="submit-order-btn" class="order-btn">Skicka beställning</button>
            </div>
          </div>`
        : ""
    }
  </div>

  ${
    logoCards
      ? `<div class="card">
          <h2 class="section-heading">Era loggor</h2>
          <p style="color:#64748b;font-size:13px;margin:4px 0 0;">De loggor och tryckunderlag vi har sparade för er.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px;">${logoCards}</div>
        </div>`
      : ""
  }

  <div id="lightbox-overlay" class="lightbox-overlay">
    <img id="lightbox-img" src="" alt="" />
  </div>

  <script>
    (function () {
      var summary = document.getElementById("order-summary");
      if (!summary) return;
      function kr(n) {
        return n.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
      }
      function esc(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
      }
      function update() {
        var rows = [], products = 0, print = 0, vat = 0;
        document.querySelectorAll(".qty-input").forEach(function (input) {
          var qty = Number(input.value);
          if (!(qty > 0)) return;
          var unit = Number(input.dataset.unit) || 0;
          var printUnit = Number(input.dataset.printUnit) || 0;
          var lineTotal = qty * (unit + printUnit);
          products += qty * unit;
          print += qty * printUnit;
          vat += lineTotal * (Number(input.dataset.tax) || 0) / 100;
          rows.push(
            "<tr><td style='padding:4px 6px;'>" + esc(input.dataset.label || "") + "</td>" +
            "<td style='padding:4px 6px;text-align:right;'>" + qty + "</td>" +
            "<td style='padding:4px 6px;text-align:right;'>" + kr(unit) + "</td>" +
            "<td style='padding:4px 6px;text-align:right;'>" + (printUnit > 0 ? kr(printUnit) : "–") + "</td>" +
            "<td style='padding:4px 6px;text-align:right;font-weight:600;'>" + kr(lineTotal) + "</td></tr>"
          );
        });
        summary.style.display = rows.length ? "block" : "none";
        document.getElementById("order-summary-rows").innerHTML = rows.join("");
        document.getElementById("sum-products").textContent = kr(products);
        document.getElementById("sum-print").textContent = kr(print);
        document.getElementById("sum-ex").textContent = kr(products + print);
        document.getElementById("sum-vat").textContent = kr(vat);
        document.getElementById("sum-total").textContent = kr(products + print + vat);
      }
      document.addEventListener("input", function (e) {
        if (e.target.classList && e.target.classList.contains("qty-input")) update();
      });
      window.__updateOrderSummary = update;
    })();

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
        fetch(${JSON.stringify(`/api/public/portal/${token}/contacts`)}, {
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
        fetch(${JSON.stringify(`/api/public/portal/${token}/request`)}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedByName: document.getElementById("requested-by-name").value || null,
            referenceContactId: referenceContactId,
            customerReference: document.getElementById("customer-reference").value || null,
            costCenter: document.getElementById("cost-center").value || null,
            pickupEmail: document.getElementById("pickup-email").value || null,
            lines: lines,
          }),
        })
          .then(function (res) {
            if (!res.ok) return res.json().then(function (body) { throw new Error(body.error || "Kunde inte skicka beställningen"); });
            return res.json();
          })
          .then(function () {
            document.querySelectorAll(".qty-input").forEach(function (input) { input.value = ""; });
            if (window.__updateOrderSummary) window.__updateOrderSummary();
            document.getElementById("requested-by-name").value = "";
            document.getElementById("customer-reference").value = "";
            document.getElementById("cost-center").value = "";
            document.getElementById("pickup-email").value = "";
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
          fetch(${JSON.stringify(`/api/public/portal/${token}/orders/`)} + btn.dataset.orderId + "/reorder", {
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
