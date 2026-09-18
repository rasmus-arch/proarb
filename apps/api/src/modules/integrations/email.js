// Outbound email — deliberately a stub for now, same reasoning as
// fortnox.js: the behaviour is built end-to-end (including the actual
// HTML that will go out), but no SMTP provider is connected yet.
// Credentials live in app_settings (smtp_host/port/username/password/
// from_email/use_tls) — filled in under Inställningar whenever a real
// provider is ready — rather than env vars, so staff can set this up
// themselves without a redeploy. Every caller already fetches `settings`
// (getSettings()) for other reasons and just passes it through; fill in
// `dispatch` below with a real send (e.g. nodemailer) once smtp_host etc.
// are set, and every caller starts working with no further changes.

export function isEmailConfigured(settings) {
  return Boolean(settings?.smtp_host);
}

function notConfigured() {
  return { ok: false, reason: "NOT_CONFIGURED", note: "E-post är inte konfigurerat ännu." };
}

// TODO: real SMTP send once settings.smtp_host etc. are set, e.g.:
//   const transport = nodemailer.createTransport({
//     host: settings.smtp_host, port: settings.smtp_port, secure: Boolean(settings.smtp_use_tls),
//     auth: { user: settings.smtp_username, pass: settings.smtp_password },
//   });
//   await transport.sendMail({ to, subject, html, from: settings.smtp_from_email });
//   return { ok: true };
async function dispatch({ settings, to, subject, html } = {}) {
  if (!isEmailConfigured(settings)) return notConfigured();
  throw new Error("Email sending not implemented yet");
}

// Called when staff marks an order "Redo för utlämning" with the
// "skicka mail" option checked.
export async function sendOrderReadyEmail({ settings, to, customerName, orderNumber }) {
  const html = buildSimpleEmailHtml({
    heading: "Din order är redo för avhämtning",
    body: `<p>Hej ${escapeHtml(customerName)},</p><p>Din order <strong>${escapeHtml(orderNumber)}</strong> är redo för avhämtning i butiken.</p>`,
  });
  return dispatch({ settings, to, subject: `Order ${orderNumber} är redo för avhämtning`, html });
}

// Called from "Maila offert till kund" in offert-editor.html — sends the
// customer a link to the public quote page (/q/:token).
export async function sendQuoteEmail({
  settings,
  to,
  customerName,
  quoteNumber,
  publicUrl,
  totalIncVat,
  validUntil,
  sellerName,
  sellerLogoUrl,
  brandColor,
}) {
  const html = buildQuoteEmailHtml({
    customerName,
    quoteNumber,
    publicUrl,
    totalIncVat,
    validUntil,
    sellerName,
    sellerLogoUrl,
    brandColor,
  });
  const subject = `Offert ${quoteNumber}${sellerName ? ` från ${sellerName}` : ""}`;
  return dispatch({ settings, to, subject, html });
}

// Called from "Skicka påminnelse" i påminnelselistan (Översikt) — en
// riktig uppföljning till kunden om en obesvarad offert, till skillnad
// från den gamla "Markera skickad"-knappen som bara satte en intern
// flagga utan att faktiskt skicka något.
export async function sendQuoteReminderEmail({
  settings,
  to,
  customerName,
  quoteNumber,
  publicUrl,
  totalIncVat,
  sellerName,
  sellerLogoUrl,
  brandColor,
}) {
  const html = buildQuoteReminderEmailHtml({
    customerName,
    quoteNumber,
    publicUrl,
    totalIncVat,
    sellerName,
    sellerLogoUrl,
    brandColor,
  });
  const subject = `Påminnelse: Offert ${quoteNumber}${sellerName ? ` från ${sellerName}` : ""}`;
  return dispatch({ settings, to, subject, html });
}

// --- HTML templates (real content, ready for dispatch() above) ------------

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

function emailShell({ preheader, bodyHtml }) {
  // Table-based layout with inline styles throughout — the only structure
  // that renders reliably across email clients (Outlook in particular
  // ignores flex/grid and most <style> blocks).
  return `<!doctype html>
<html lang="sv">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f8fafc;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader ?? "")}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
          <tr><td style="padding:28px 28px 8px;">${bodyHtml}</td></tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #f1f5f9;margin-top:16px;">
              <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;font-family:system-ui,sans-serif;">
                Det här mejlet skickades automatiskt från ProArb.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildSimpleEmailHtml({ heading, body }) {
  return emailShell({
    preheader: heading,
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:18px;font-family:system-ui,sans-serif;color:#0f172a;">${escapeHtml(heading)}</h1>
      <div style="font-family:system-ui,sans-serif;font-size:14px;color:#334155;line-height:1.6;">${body}</div>`,
  });
}

function buildQuoteEmailHtml({
  customerName,
  quoteNumber,
  publicUrl,
  totalIncVat,
  validUntil,
  sellerName,
  sellerLogoUrl,
  brandColor,
}) {
  const color = brandColor || "#0f172a";
  const validUntilText = validUntil
    ? new Date(validUntil).toLocaleDateString("sv-SE", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const bodyHtml = `
    ${sellerLogoUrl ? `<img src="${escapeHtml(sellerLogoUrl)}" alt="${escapeHtml(sellerName ?? "")}" style="max-height:36px;margin-bottom:16px;" />` : ""}
    <p style="margin:0 0 4px;font-family:system-ui,sans-serif;font-size:13px;font-weight:600;color:${color};">${escapeHtml(sellerName ?? "")}</p>
    <h1 style="margin:0 0 16px;font-family:system-ui,sans-serif;font-size:20px;color:#0f172a;">Offert ${escapeHtml(quoteNumber)}</h1>
    <p style="margin:0 0 16px;font-family:system-ui,sans-serif;font-size:14px;color:#334155;line-height:1.6;">
      Hej ${escapeHtml(customerName ?? "")},<br /><br />
      Här kommer er offert${sellerName ? ` från ${escapeHtml(sellerName)}` : ""}.
      Klicka på knappen nedan för att se den, ladda ner den som PDF och svara direkt.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="border-radius:6px;background:${color};">
          <a href="${escapeHtml(publicUrl)}" style="display:inline-block;padding:12px 24px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Visa offert</a>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding-top:12px;font-family:system-ui,sans-serif;font-size:13px;color:#64748b;">
      <tr>
        <td>Totalt (inkl. moms)</td>
        <td align="right" style="font-weight:600;color:#0f172a;">${money(totalIncVat)}</td>
      </tr>
      ${
        validUntilText
          ? `<tr><td style="padding-top:4px;">Giltig till</td><td align="right" style="padding-top:4px;">${escapeHtml(validUntilText)}</td></tr>`
          : ""
      }
    </table>
    <p style="margin:20px 0 0;font-family:system-ui,sans-serif;font-size:12px;color:#94a3b8;word-break:break-all;">
      Fungerar knappen inte? Kopiera länken: ${escapeHtml(publicUrl)}
    </p>`;

  return emailShell({ preheader: `Offert ${quoteNumber} — ${money(totalIncVat)}`, bodyHtml });
}

function buildQuoteReminderEmailHtml({ customerName, quoteNumber, publicUrl, totalIncVat, sellerName, sellerLogoUrl, brandColor }) {
  const color = brandColor || "#0f172a";
  const bodyHtml = `
    ${sellerLogoUrl ? `<img src="${escapeHtml(sellerLogoUrl)}" alt="${escapeHtml(sellerName ?? "")}" style="max-height:36px;margin-bottom:16px;" />` : ""}
    <p style="margin:0 0 4px;font-family:system-ui,sans-serif;font-size:13px;font-weight:600;color:${color};">${escapeHtml(sellerName ?? "")}</p>
    <h1 style="margin:0 0 16px;font-family:system-ui,sans-serif;font-size:20px;color:#0f172a;">Påminnelse: Offert ${escapeHtml(quoteNumber)}</h1>
    <p style="margin:0 0 16px;font-family:system-ui,sans-serif;font-size:14px;color:#334155;line-height:1.6;">
      Hej ${escapeHtml(customerName ?? "")},<br /><br />
      Vi ville bara påminna om att ni har en offert som väntar på svar. Klicka på knappen nedan för att se den igen.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr>
        <td style="border-radius:6px;background:${color};">
          <a href="${escapeHtml(publicUrl)}" style="display:inline-block;padding:12px 24px;font-family:system-ui,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Visa offert</a>
        </td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f1f5f9;padding-top:12px;font-family:system-ui,sans-serif;font-size:13px;color:#64748b;">
      <tr>
        <td>Totalt (inkl. moms)</td>
        <td align="right" style="font-weight:600;color:#0f172a;">${money(totalIncVat)}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;font-family:system-ui,sans-serif;font-size:12px;color:#94a3b8;word-break:break-all;">
      Fungerar knappen inte? Kopiera länken: ${escapeHtml(publicUrl)}
    </p>`;

  return emailShell({ preheader: `Påminnelse: Offert ${quoteNumber} väntar på svar`, bodyHtml });
}
