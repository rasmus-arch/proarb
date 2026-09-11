import { Router } from "express";
import * as quotes from "./service.js";
import { generateQuotePdf } from "./pdf.js";

// The customer-facing side of a quote: no login, reached only by knowing
// the unguessable public_token. Mounted at /api/public/quotes in index.js;
// the actual HTML page lives at GET /q/:token (see renderPublicQuotePage,
// registered directly on the app since it isn't a JSON API route).

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function money(n) {
  return `${Number(n).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

const STATUS_LABELS = {
  DRAFT: "Utkast",
  SENT: "Skickad",
  VIEWED: "Visad",
  ACCEPTED: "Accepterad",
  DECLINED: "Avböjd",
  EXPIRED: "Utgången",
  CONVERTED: "Omvandlad till order",
};

export async function renderPublicQuotePage(req, res) {
  const quote = await quotes.getQuoteByToken(req.params.token);
  if (!quote) {
    res.status(404).send("<h1>Offerten hittades inte</h1>");
    return;
  }

  if (quote.status === "SENT") {
    await quotes.markViewed(quote.id);
    quote.status = "VIEWED";
  }

  const canRespond = ["SENT", "VIEWED"].includes(quote.status);

  const rowsHtml = quote.lines
    .map(
      (line) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">
          <div style="font-weight:600;color:#0f172a;">${escapeHtml(line.product_name)}</div>
          <div style="color:#64748b;font-size:13px;">${escapeHtml([line.color, line.size].filter(Boolean).join(" / "))}</div>
          ${line.print_method_name ? `<div style="color:#64748b;font-size:13px;">Tryck: ${escapeHtml(line.print_method_name)}</div>` : ""}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${line.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(line.unit_price)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${money(line.line_total)}</td>
      </tr>`
    )
    .join("");

  res.send(`<!doctype html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Offert ${escapeHtml(quote.quote_number)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#f8fafc; color:#0f172a; margin:0; padding:24px 16px; }
    .card { max-width: 720px; margin: 0 auto; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:24px; }
    table { width:100%; border-collapse:collapse; margin-top:16px; font-size:14px; }
    th { text-align:left; font-size:12px; color:#64748b; padding:8px 12px; border-bottom:1px solid #cbd5e1; }
    .btn { display:inline-flex; align-items:center; justify-content:center; border-radius:6px; padding:10px 18px; font-size:14px; font-weight:500; border:none; cursor:pointer; }
    .btn-accept { background:#0f172a; color:#fff; }
    .btn-decline { background:#fff; color:#0f172a; border:1px solid #cbd5e1; }
    .status { display:inline-block; padding:2px 10px; border-radius:999px; font-size:12px; background:#e2e8f0; color:#334155; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <div>
        <h1 style="margin:0;font-size:20px;">Offert ${escapeHtml(quote.quote_number)}</h1>
        <p style="color:#64748b;margin:4px 0 0;">Till ${escapeHtml(quote.customer_name)}</p>
      </div>
      <span class="status">${STATUS_LABELS[quote.status] ?? quote.status}</span>
    </div>

    <table>
      <thead><tr><th>Produkt</th><th style="text-align:right;">Antal</th><th style="text-align:right;">à-pris ex moms</th><th style="text-align:right;">Summa ex moms</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div style="margin-top:16px;text-align:right;font-size:14px;">
      <div>Delsumma ex moms: ${money(quote.totals.subtotal_ex_vat)}</div>
      <div>Moms: ${money(quote.totals.vat_amount)}</div>
      <div style="font-weight:700;font-size:16px;margin-top:4px;">Totalt: ${money(quote.totals.total_inc_vat)}</div>
    </div>

    ${quote.notes ? `<p style="margin-top:16px;color:#475569;white-space:pre-wrap;">${escapeHtml(quote.notes)}</p>` : ""}

    <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
      <a class="btn btn-secondary" style="border:1px solid #cbd5e1;color:#0f172a;text-decoration:none;" href="/q/${quote.public_token}/pdf">Ladda ner PDF</a>
      ${
        canRespond
          ? `
        <button class="btn btn-accept" id="accept-btn">Acceptera offert</button>
        <button class="btn btn-decline" id="decline-btn">Avböj</button>`
          : ""
      }
    </div>
    <p id="response-message" style="margin-top:12px;"></p>
  </div>

  <script>
    const token = ${JSON.stringify(quote.public_token)};
    async function respond(decision) {
      const res = await fetch('/api/public/quotes/' + token + '/' + decision, { method: 'POST' });
      const body = await res.json();
      const msg = document.getElementById('response-message');
      if (res.ok) {
        msg.textContent = decision === 'accept' ? 'Tack! Offerten är accepterad.' : 'Offerten har avböjts.';
        msg.style.color = '#15803d';
        document.querySelectorAll('.btn-accept, .btn-decline').forEach((b) => (b.disabled = true));
      } else {
        msg.textContent = body.error || 'Något gick fel.';
        msg.style.color = '#dc2626';
      }
    }
    document.getElementById('accept-btn')?.addEventListener('click', () => respond('accept'));
    document.getElementById('decline-btn')?.addEventListener('click', () => respond('decline'));
  </script>
</body>
</html>`);
}

export async function renderPublicQuotePdf(req, res, next) {
  try {
    const quote = await quotes.getQuoteByToken(req.params.token);
    if (!quote) return res.status(404).send("Not found");
    const publicUrl = `${req.protocol}://${req.get("host")}/q/${quote.public_token}`;
    const pdf = await generateQuotePdf(quote, { publicUrl });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${quote.quote_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
}

const router = Router();

router.post("/:token/accept", async (req, res, next) => {
  try {
    const quote = await quotes.respondToQuote(req.params.token, "accept");
    if (!quote) return res.status(404).json({ error: "Not found" });
    if (quote.status !== "ACCEPTED") {
      return res.status(409).json({ error: "Offerten kan inte längre besvaras" });
    }
    res.json({ status: quote.status });
  } catch (err) {
    next(err);
  }
});

router.post("/:token/decline", async (req, res, next) => {
  try {
    const quote = await quotes.respondToQuote(req.params.token, "decline");
    if (!quote) return res.status(404).json({ error: "Not found" });
    if (quote.status !== "DECLINED") {
      return res.status(409).json({ error: "Offerten kan inte längre besvaras" });
    }
    res.json({ status: quote.status });
  } catch (err) {
    next(err);
  }
});

export default router;
