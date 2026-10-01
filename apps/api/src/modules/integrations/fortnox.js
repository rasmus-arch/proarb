// Fortnox integration — real OAuth2 + REST calls. Credentials/tokens live
// in app_settings (fortnox_client_id/client_secret/access_token/
// refresh_token/token_expires_at) rather than env vars, filled in under
// Inställningar so staff can connect/reconnect without a redeploy. Every
// caller already fetches `settings` (getSettings()) for other reasons and
// just passes it through.
//
// OAuth2 (authorization code, "offline" access): the connect/callback/
// disconnect HTTP endpoints live in settings/routes.js — this module only
// builds the authorization URL, exchanges the code, and refreshes the
// access token (rotating the refresh token every time, per Fortnox's
// flow) transparently before each API call.

import { pool } from "../../lib/db.js";
import { updateSettings } from "../settings/service.js";
import { getCustomer } from "../customers/service.js";

const AUTHORIZE_URL = "https://apps.fortnox.se/oauth-v1/auth";
const TOKEN_URL = "https://apps.fortnox.se/oauth-v1/token";
const API_BASE = "https://api.fortnox.se/3";
const SCOPES = "invoice customer";

export function isFortnoxConfigured(settings) {
  return Boolean(settings?.fortnox_access_token);
}

function notConfigured() {
  return { ok: false, reason: "NOT_CONFIGURED", note: "Fortnox är inte konfigurerat ännu." };
}

// --- OAuth2 -----------------------------------------------------------

// Called from GET /api/settings/fortnox/connect. Persists a random
// `state` on app_settings so the callback can reject a forged request,
// then returns the URL to redirect the admin's browser to.
export async function getConnectUrl(settings, redirectUri) {
  if (!settings?.fortnox_client_id || !settings?.fortnox_client_secret) {
    throw new Error("Fyll i och spara Fortnox Client ID/Client Secret innan du ansluter.");
  }
  const state = randomState();
  await pool.query(`UPDATE app_settings SET fortnox_oauth_state = ? WHERE id = 1`, [state]);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", settings.fortnox_client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("response_type", "code");
  return url.toString();
}

function randomState() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

// Called from GET /api/settings/fortnox/callback with the ?code&state
// Fortnox redirected back with.
export async function handleOAuthCallback({ settings, code, state, redirectUri }) {
  if (!code) throw new Error("Fortnox skickade ingen kod tillbaka.");
  if (!state || state !== settings.fortnox_oauth_state) {
    throw new Error("Ogiltig eller utgången inloggningsförfrågan (state matchar inte) — försök igen.");
  }
  await requestAndPersistToken({
    settings,
    body: { grant_type: "authorization_code", code, redirect_uri: redirectUri },
  });
  await pool.query(`UPDATE app_settings SET fortnox_oauth_state = NULL WHERE id = 1`);
}

export async function disconnectFortnox() {
  await pool.query(
    `UPDATE app_settings
     SET fortnox_access_token = NULL, fortnox_refresh_token = NULL, fortnox_token_expires_at = NULL
     WHERE id = 1`
  );
}

async function requestAndPersistToken({ settings, body }) {
  const basicAuth = Buffer.from(`${settings.fortnox_client_id}:${settings.fortnox_client_secret}`).toString(
    "base64"
  );
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Fortnox OAuth-fel (${res.status})`);
  }

  const expiresAt = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000);
  const updated = await updateSettings({
    fortnoxAccessToken: data.access_token,
    fortnoxRefreshToken: data.refresh_token,
  });
  await pool.query(`UPDATE app_settings SET fortnox_token_expires_at = ? WHERE id = 1`, [expiresAt]);
  // Fångar en kapad token direkt (för kort databaskolumn) istället för att
  // den först ger 401 vid nästa fakturering.
  if (updated.fortnox_access_token !== data.access_token || updated.fortnox_refresh_token !== data.refresh_token) {
    throw new Error(
      "Fortnox-nyckeln kunde inte sparas hel i databasen. Starta om appen (så att databasen uppdateras) och anslut till Fortnox igen."
    );
  }
  return { ...updated, fortnox_token_expires_at: expiresAt };
}

function refreshToken(settings) {
  return requestAndPersistToken({
    settings,
    body: { grant_type: "refresh_token", refresh_token: settings.fortnox_refresh_token },
  });
}

// Refreshes ahead of expiry (60s margin) rather than reacting to a 401,
// since Fortnox rotates the refresh token on every use — the old one
// stored in `settings` becomes invalid the moment a new one is issued, so
// every caller must keep using the freshly persisted `settings` returned
// here instead of the one it was passed.
async function ensureFreshToken(settings) {
  if (!isFortnoxConfigured(settings)) throw new Error("NOT_CONFIGURED");
  const expiresAt = settings.fortnox_token_expires_at ? new Date(settings.fortnox_token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 60_000) return settings;
  return refreshToken(settings);
}

async function fortnoxRequest(settings, path, { method = "GET", body } = {}) {
  let fresh = await ensureFreshToken(settings);
  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${fresh.fortnox_access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send();
  // 401 trots att token inte borde ha gått ut (t.ex. återkallad, eller
  // kapad före kolumnfixen): förnya en gång och försök igen.
  if (res.status === 401) {
    try {
      fresh = await refreshToken(fresh);
    } catch (err) {
      throw new Error(
        `Fortnox godkänner inte anslutningen längre (${err.message}). Anslut igen under Inställningar → Integrationer.`
      );
    }
    res = await send();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Fortnox godkänner inte anslutningen (401). Anslut igen under Inställningar → Integrationer.");
    }
    if (res.status === 403) {
      throw new Error(
        `Fortnox nekade åtkomst (403)${data?.ErrorInformation?.message ? `: ${data.ErrorInformation.message}` : ""}. Kontrollera att Fortnox-appen har behörighet till kunder och fakturor och att användaren som anslöt har rätt licens.`
      );
    }
    // Fortnox felsvar: { ErrorInformation: { error, message, code } } —
    // ibland med stor bokstav (Message/Code). Hela svaret loggas så att det
    // syns i serverloggen (cPanel: stderr.log i appens mapp).
    const info = data?.ErrorInformation ?? data?.errorInformation ?? {};
    const text = info.message ?? info.Message ?? data?.message ?? data?.error_description;
    const code = info.code ?? info.Code;
    console.warn(
      `Fortnox ${method} ${path} -> ${res.status}: ${JSON.stringify(data)}${res.status === 400 && body ? ` | skickat: ${JSON.stringify(body)}` : ""}`
    );
    const err = new Error(
      `Fortnox svarade ${res.status}${code ? ` (kod ${code})` : ""}: ${text || "okänt fel — se serverloggen"}`
    );
    err.fortnoxStatus = res.status;
    err.fortnoxText = String(text ?? "");
    throw err;
  }
  return { data, settings: fresh };
}

// Lägger till vilket steg som gick fel ("Kunde inte skapa fakturan: …").
async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    err.message = `${label}: ${err.message}`;
    throw err;
  }
}

// Fortnox vill ha organisationsnummer som NNNNNN-NNNN. 12 siffror
// (med sekel, t.ex. 19/20 före personnummer) kortas till 10. Annat
// format skickas inte alls hellre än att stoppa faktureringen.
export function normalizeOrgNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 ? digits.slice(2) : digits;
  return ten.length === 10 ? `${ten.slice(0, 6)}-${ten.slice(6)}` : undefined;
}

function validEmail(value) {
  const email = String(value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

// --- Customers ----------------------------------------------------------

// Fortnox customers are looked up once and cached on customers.
// fortnox_customer_number — never re-searched by org number afterwards,
// so a customer never ends up duplicated in Fortnox because of a lookup
// mismatch.
async function findOrCreateFortnoxCustomer(settings, customerId) {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (customer.fortnox_customer_number) {
    return { customerNumber: customer.fortnox_customer_number, settings };
  }

  const fields = {
    Name: customer.name,
    OrganisationNumber: normalizeOrgNumber(customer.org_number),
    Email: validEmail(customer.invoice_email) ?? validEmail(customer.email),
    Address1: customer.address || undefined,
    ZipCode: customer.postal_code || undefined,
    City: customer.city || undefined,
    CountryCode: customer.country || "SE",
    Phone1: customer.phone || undefined,
  };
  const create = (customerFields) =>
    fortnoxRequest(settings, "/customers", { method: "POST", body: { Customer: customerFields } });

  let response;
  try {
    response = await step("Kunde inte skapa kunden i Fortnox", () => create(fields));
  } catch (err) {
    // Ett organisationsnummer Fortnox inte godtar (t.ex. felaktig
    // kontrollsiffra) ska inte stoppa faktureringen — skapa kunden utan.
    if (err.fortnoxStatus === 400 && fields.OrganisationNumber && /organisation/i.test(err.fortnoxText)) {
      response = await step("Kunde inte skapa kunden i Fortnox", () => create({ ...fields, OrganisationNumber: undefined }));
    } else {
      throw err;
    }
  }
  const { data, settings: settingsAfter } = response;
  const customerNumber = data.Customer.CustomerNumber;
  await pool.query(`UPDATE customers SET fortnox_customer_number = ? WHERE id = ?`, [customerNumber, customer.id]);
  return { customerNumber, settings: settingsAfter };
}

// --- Invoice rows ---------------------------------------------------------

// order_lines/order_return_lines rows (quantity, unit_price,
// discount_percent, tax_rate_percent, plus an optional print_price/
// print_discount_percent) turned into Fortnox InvoiceRows — a tryck/
// brodyr price on a line becomes its own row so it's itemised on the
// Fortnox invoice too, not just folded into the product row's price.
function buildInvoiceRows(lines) {
  const rows = [];
  for (const line of lines ?? []) {
    const quantity = Number(line.quantity);
    if (!(quantity > 0)) continue;
    const name = line.description || [line.product_name, line.color, line.size].filter(Boolean).join(" ") || "Rad";

    // Rabatt i kr/st skickas som nettopris (à-pris minus rabatten), så
    // att raden blir exakt — utan att vara beroende av hur Fortnox tolkar
    // en beloppsrabatt (per styck eller per rad).
    const discountAmount = Number(line.discount_amount ?? 0);
    rows.push(
      discountAmount > 0
        ? {
            Description: name,
            DeliveredQuantity: String(quantity),
            Price: Math.round((Number(line.unit_price) * (1 - Number(line.discount_percent ?? 0) / 100) - discountAmount) * 100) / 100,
            VAT: Number(line.tax_rate_percent ?? 25),
          }
        : {
            Description: name,
            DeliveredQuantity: String(quantity),
            Price: Number(line.unit_price),
            Discount: Number(line.discount_percent ?? 0),
            DiscountType: "PERCENT",
            VAT: Number(line.tax_rate_percent ?? 25),
          }
    );

    if (line.print_price !== null && line.print_price !== undefined) {
      rows.push({
        Description: `Tryck/brodyr – ${name}`,
        DeliveredQuantity: String(quantity),
        Price: Number(line.print_price),
        Discount: Number(line.print_discount_percent ?? 0),
        DiscountType: "PERCENT",
        VAT: Number(line.tax_rate_percent ?? 25),
      });
    }
  }
  return rows;
}

// --- Invoices ---------------------------------------------------------

// Called when an order becomes DELIVERED (recordPickup in orders/service.js).
//
// `cash: true` (kontantkund, t.ex. Swish-kunden) skapar istället en
// kontantfaktura — redan betald, förfaller samma dag — och bokför den
// direkt, så den aldrig hamnar bland obetalda kundfakturor eller skickas
// till någon. PaymentWay styrs av Inställningar (standard SW = Swish).
export async function createCustomerInvoice({ settings, customerId, lines, orderId, orderNumber, cash = false } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const invoiceRows = buildInvoiceRows(lines);
  if (invoiceRows.length === 0) throw new Error("Ordern har inga rader att fakturera.");

  const { customerNumber, settings: settingsAfter } = await findOrCreateFortnoxCustomer(settings, customerId);
  const cashFields = cash
    ? {
        InvoiceType: "CASHINVOICE",
        PaymentWay: settings.fortnox_cash_payment_way || "SW",
        DueDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }),
      }
    : {};
  const { data, settings: settingsAfterInvoice } = await step("Kunde inte skapa fakturan i Fortnox", () =>
    fortnoxRequest(settingsAfter, "/invoices", {
    method: "POST",
    body: {
      Invoice: {
        CustomerNumber: customerNumber,
        YourOrderNumber: orderNumber ?? (orderId != null ? String(orderId) : undefined),
        InvoiceRows: invoiceRows,
        ...cashFields,
      },
    },
  }));
  const documentNumber = data.Invoice.DocumentNumber;

  if (cash) {
    // Fakturan finns redan i Fortnox även om bokföringen skulle misslyckas
    // — rapportera det som en anteckning, inte som ett fel, så att den inte
    // skapas en gång till.
    try {
      await fortnoxRequest(settingsAfterInvoice, `/invoices/${documentNumber}/bookkeep`, { method: "PUT", body: {} });
    } catch (err) {
      return {
        ok: true,
        invoiceNumber: documentNumber,
        externalRef: documentNumber,
        note: `Kontantfakturan skapades men kunde inte bokföras: ${err.message}`,
      };
    }
  }
  return { ok: true, invoiceNumber: documentNumber, externalRef: documentNumber };
}

// Credits back a previously sent customer invoice on a full/partial
// return (orders/returns.js). `originalExternalRef`, when known, links
// the credit invoice back to the original one in Fortnox — purely
// informational, Fortnox doesn't require it to accept the credit.
export async function createCreditInvoice({ settings, customerId, lines, orderId, originalExternalRef } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const invoiceRows = buildInvoiceRows(lines);
  if (invoiceRows.length === 0) throw new Error("Returen har inga rader att kreditera.");

  const { customerNumber, settings: settingsAfter } = await findOrCreateFortnoxCustomer(settings, customerId);
  const { data } = await step("Kunde inte skapa kreditfakturan i Fortnox", () =>
    fortnoxRequest(settingsAfter, "/invoices", {
    method: "POST",
    body: {
      Invoice: {
        CustomerNumber: customerNumber,
        Credit: true,
        CreditInvoiceReference: originalExternalRef || undefined,
        YourOrderNumber: orderId != null ? String(orderId) : undefined,
        InvoiceRows: invoiceRows,
      },
    },
  }));
  return { ok: true, invoiceNumber: data.Invoice.DocumentNumber, externalRef: data.Invoice.DocumentNumber };
}

// Emails an already-created invoice (see createCustomerInvoice above) to
// the customer from Fortnox. Called when an order is marked "Fakturerad".
export async function sendCustomerInvoice({ settings, externalRef } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  if (!externalRef) return { ok: false, reason: "NO_REF", note: "Ingen Fortnox-faktura att skicka." };
  await step("Kunde inte mejla fakturan från Fortnox", () =>
    fortnoxRequest(settings, `/invoices/${externalRef}/email`, { method: "PUT", body: {} })
  );
  return { ok: true };
}
