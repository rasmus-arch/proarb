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
  return { ...updated, fortnox_token_expires_at: expiresAt };
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
  return requestAndPersistToken({
    settings,
    body: { grant_type: "refresh_token", refresh_token: settings.fortnox_refresh_token },
  });
}

async function fortnoxRequest(settings, path, { method = "GET", body } = {}) {
  const fresh = await ensureFreshToken(settings);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${fresh.fortnox_access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.ErrorInformation?.message || data?.error_description || `Fortnox API-fel (${res.status})`;
    throw new Error(message);
  }
  return { data, settings: fresh };
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

  const { data, settings: settingsAfter } = await fortnoxRequest(settings, "/customers", {
    method: "POST",
    body: {
      Customer: {
        Name: customer.name,
        OrganisationNumber: customer.org_number || undefined,
        Email: customer.invoice_email || customer.email || undefined,
        Address1: customer.address || undefined,
        ZipCode: customer.postal_code || undefined,
        City: customer.city || undefined,
        CountryCode: customer.country || "SE",
        Phone1: customer.phone || undefined,
      },
    },
  });
  const customerNumber = data.Customer.CustomerNumber;
  await pool.query(`UPDATE customers SET fortnox_customer_number = ? WHERE id = ?`, [customerNumber, customer.id]);
  return { customerNumber, settings: settingsAfter };
}

// Generic walk-in customer used for kontantfaktura (createCashInvoice)
// sales with no real customer attached — created once in Fortnox and then
// reused via app_settings.fortnox_cash_customer_number.
async function ensureCashCustomer(settings) {
  if (settings.fortnox_cash_customer_number) {
    return { customerNumber: settings.fortnox_cash_customer_number, settings };
  }
  const { data, settings: settingsAfter } = await fortnoxRequest(settings, "/customers", {
    method: "POST",
    body: { Customer: { Name: "Kontantkund" } },
  });
  const customerNumber = data.Customer.CustomerNumber;
  await pool.query(`UPDATE app_settings SET fortnox_cash_customer_number = ? WHERE id = 1`, [customerNumber]);
  return { customerNumber, settings: { ...settingsAfter, fortnox_cash_customer_number: customerNumber } };
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

    rows.push({
      Description: name,
      DeliveredQuantity: String(quantity),
      Price: Number(line.unit_price),
      Discount: Number(line.discount_percent ?? 0),
      DiscountType: "PERCENT",
      VAT: Number(line.tax_rate_percent ?? 25),
    });

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
export async function createCustomerInvoice({ settings, customerId, lines, orderId, orderNumber } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const invoiceRows = buildInvoiceRows(lines);
  if (invoiceRows.length === 0) throw new Error("Ordern har inga rader att fakturera.");

  const { customerNumber, settings: settingsAfter } = await findOrCreateFortnoxCustomer(settings, customerId);
  const { data } = await fortnoxRequest(settingsAfter, "/invoices", {
    method: "POST",
    body: {
      Invoice: {
        CustomerNumber: customerNumber,
        YourOrderNumber: orderNumber ?? (orderId != null ? String(orderId) : undefined),
        InvoiceRows: invoiceRows,
      },
    },
  });
  return { ok: true, invoiceNumber: data.Invoice.DocumentNumber, externalRef: data.Invoice.DocumentNumber };
}

// "Kontantfaktura" — a walk-in/Swish sale with no customer record, booked
// against the shared Kontantkund (see ensureCashCustomer above).
export async function createCashInvoice({ settings, lines, reference } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const invoiceRows = buildInvoiceRows(lines);
  if (invoiceRows.length === 0) throw new Error("Köpet har inga rader att fakturera.");

  const { customerNumber, settings: settingsAfter } = await ensureCashCustomer(settings);
  const { data } = await fortnoxRequest(settingsAfter, "/invoices", {
    method: "POST",
    body: {
      Invoice: {
        CustomerNumber: customerNumber,
        YourReference: reference || undefined,
        InvoiceRows: invoiceRows,
      },
    },
  });
  return { ok: true, invoiceNumber: data.Invoice.DocumentNumber, externalRef: data.Invoice.DocumentNumber };
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
  const { data } = await fortnoxRequest(settingsAfter, "/invoices", {
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
  });
  return { ok: true, invoiceNumber: data.Invoice.DocumentNumber, externalRef: data.Invoice.DocumentNumber };
}

// Emails an already-created invoice (see createCustomerInvoice above) to
// the customer from Fortnox. Called when an order is marked "Fakturerad".
export async function sendCustomerInvoice({ settings, externalRef } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  if (!externalRef) return { ok: false, reason: "NO_REF", note: "Ingen Fortnox-faktura att skicka." };
  await fortnoxRequest(settings, `/invoices/${externalRef}/email`, { method: "PUT", body: {} });
  return { ok: true };
}
