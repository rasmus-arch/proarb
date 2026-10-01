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
// invoice: fakturor (skapa, bokföra, mejla). customer: kunder (hämta,
// skapa, uppdatera). payment: registrera inbetalning på Swish-köp med
// ett eget betalsätt (t.ex. SW), se createCustomerInvoice.
const SCOPES = "invoice customer payment";

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

// Fokus-kund -> Fortnox Customer-fält. Fortnox mejlar fakturor till
// EmailInvoice om den finns, annars till Email.
function customerFields(customer) {
  return {
    Name: customer.name,
    OrganisationNumber: normalizeOrgNumber(customer.org_number),
    Email: validEmail(customer.email),
    EmailInvoice: validEmail(customer.invoice_email),
    Address1: customer.address || undefined,
    ZipCode: customer.postal_code || undefined,
    City: customer.city || undefined,
    CountryCode: customer.country || "SE",
    Phone1: customer.phone || undefined,
  };
}

// POST/PUT av en kund. Ett organisationsnummer Fortnox inte godtar (t.ex.
// felaktig kontrollsiffra) ska inte stoppa något — då skickas kunden utan.
async function writeCustomer(settings, method, path, fields, label) {
  const send = (f) => fortnoxRequest(settings, path, { method, body: { Customer: f } });
  try {
    return await step(label, () => send(fields));
  } catch (err) {
    if (err.fortnoxStatus === 400 && fields.OrganisationNumber && /organisation/i.test(err.fortnoxText)) {
      return step(label, () => send({ ...fields, OrganisationNumber: undefined }));
    }
    throw err;
  }
}

// Alla kunder i Fortnox (listvyn: nummer, namn, org.nr, e-post, adress,
// telefon). Hämtas 500 åt gången.
export async function fetchAllFortnoxCustomers(settings) {
  if (!isFortnoxConfigured(settings)) throw new Error("NOT_CONFIGURED");
  const all = [];
  let current = settings;
  for (let page = 1; page <= 200; page++) {
    const { data, settings: next } = await step("Kunde inte hämta kunder från Fortnox", () =>
      fortnoxRequest(current, `/customers?limit=500&page=${page}`)
    );
    current = next;
    all.push(...(data.Customers ?? []));
    const totalPages = Number(data.MetaInformation?.["@TotalPages"] ?? 1);
    if (page >= totalPages) break;
  }
  return { customers: all, settings: current };
}

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// Finns kunden redan i Fortnox? Samma organisationsnummer, annars exakt
// samma namn — så att en kund som redan fanns där inte skapas en gång till.
async function findExistingFortnoxCustomer(settings, customer) {
  const { customers, settings: after } = await fetchAllFortnoxCustomers(settings);
  const org = digits(customer.org_number);
  const match =
    (org.length >= 10 && customers.find((c) => digits(c.OrganisationNumber).endsWith(org.slice(-10)))) ||
    customers.find((c) => sameName(c.Name, customer.name));
  return { customerNumber: match?.CustomerNumber ?? null, settings: after };
}

async function linkCustomer(customerId, customerNumber) {
  await pool.query(`UPDATE customers SET fortnox_customer_number = ? WHERE id = ?`, [customerNumber, customerId]);
}

// Fortnox-kundnumret cachas på customers.fortnox_customer_number — slås
// bara upp (och skapas vid behov) första gången.
async function findOrCreateFortnoxCustomer(settings, customerId) {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (customer.fortnox_customer_number) {
    return { customerNumber: customer.fortnox_customer_number, settings };
  }

  const existing = await findExistingFortnoxCustomer(settings, customer);
  if (existing.customerNumber) {
    await linkCustomer(customer.id, existing.customerNumber);
    return existing;
  }

  const { data, settings: settingsAfter } = await writeCustomer(
    existing.settings,
    "POST",
    "/customers",
    customerFields(customer),
    "Kunde inte skapa kunden i Fortnox"
  );
  const customerNumber = data.Customer.CustomerNumber;
  await linkCustomer(customer.id, customerNumber);
  return { customerNumber, settings: settingsAfter };
}

// Skickar en kunds uppgifter från Fokus till Fortnox (efter att kunden
// sparats/skapats i Fokus). Kopplar ihop med en befintlig Fortnox-kund om
// en sådan finns, annars skapas den.
export async function pushCustomerToFortnox({ settings, customerId } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  if (!customer.fortnox_customer_number) {
    const { customerNumber, settings: after } = await findOrCreateFortnoxCustomer(settings, customerId);
    // En befintlig Fortnox-kund som nyss kopplades får också Fokus-uppgifterna.
    await writeCustomer(after, "PUT", `/customers/${encodeURIComponent(customerNumber)}`, customerFields(customer), "Kunde inte uppdatera kunden i Fortnox");
    return { ok: true, customerNumber };
  }

  await writeCustomer(
    settings,
    "PUT",
    `/customers/${encodeURIComponent(customer.fortnox_customer_number)}`,
    customerFields(customer),
    "Kunde inte uppdatera kunden i Fortnox"
  );
  return { ok: true, customerNumber: customer.fortnox_customer_number };
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
// Fortnox kontantfakturor godtar bara de här som PaymentWay.
const CASH_INVOICE_PAYMENT_WAYS = new Set(["CASH", "CARD", "AG"]);

function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

// Called when an order becomes DELIVERED (recordPickup in orders/service.js).
//
// `cash: true` (kontantkund, t.ex. Swish-kunden) — betalt på plats, skickas
// aldrig till någon. Hur det bokas styrs av Inställningar → "Betalsätt på
// kontantfakturor":
//  - CASH/CARD/AG: en kontantfaktura (CASHINVOICE) med det betalsättet,
//    bokförd direkt.
//  - annan kod, t.ex. SW: ett betalsätt i Fortnox (Inställningar →
//    Bokföring → Betalsätt). Då skapas en vanlig faktura som bokförs och
//    direkt registreras som betald med det betalsättet — så att pengarna
//    hamnar på betalsättets konto (t.ex. 1930 för Swish).
export async function createCustomerInvoice({ settings, customerId, lines, orderId, orderNumber, cash = false } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  const invoiceRows = buildInvoiceRows(lines);
  if (invoiceRows.length === 0) throw new Error("Ordern har inga rader att fakturera.");

  const paymentCode = String(settings.fortnox_cash_payment_way || "SW").trim().toUpperCase();
  const asCashInvoice = cash && CASH_INVOICE_PAYMENT_WAYS.has(paymentCode);
  const paidWithModeOfPayment = cash && !asCashInvoice;

  const { customerNumber, settings: settingsAfter } = await findOrCreateFortnoxCustomer(settings, customerId);
  const extraFields = asCashInvoice
    ? { InvoiceType: "CASHINVOICE", PaymentWay: paymentCode, DueDate: today() }
    : paidWithModeOfPayment
      ? { DueDate: today() }
      : {};
  const { data, settings: settingsAfterInvoice } = await step("Kunde inte skapa fakturan i Fortnox", () =>
    fortnoxRequest(settingsAfter, "/invoices", {
      method: "POST",
      body: {
        Invoice: {
          CustomerNumber: customerNumber,
          YourOrderNumber: orderNumber ?? (orderId != null ? String(orderId) : undefined),
          InvoiceRows: invoiceRows,
          ...extraFields,
        },
      },
    })
  );
  const documentNumber = data.Invoice.DocumentNumber;
  const created = { ok: true, invoiceNumber: documentNumber, externalRef: documentNumber };
  if (!cash) return created;

  // Fakturan finns redan i Fortnox även om något av stegen nedan skulle
  // misslyckas — rapportera det som en anteckning, inte som ett fel, så att
  // den inte skapas en gång till.
  let current = settingsAfterInvoice;
  try {
    ({ settings: current } = await fortnoxRequest(current, `/invoices/${documentNumber}/bookkeep`, {
      method: "PUT",
      body: {},
    }));
  } catch (err) {
    return { ...created, note: `Fakturan skapades men kunde inte bokföras: ${err.message}` };
  }
  if (asCashInvoice) return created;

  let payment;
  try {
    const total = Number(data.Invoice.Total);
    ({ data: payment, settings: current } = await fortnoxRequest(current, "/invoicepayments", {
      method: "POST",
      body: {
        InvoicePayment: {
          InvoiceNumber: Number(documentNumber),
          Amount: total,
          AmountCurrency: total,
          PaymentDate: today(),
          ModeOfPayment: paymentCode,
        },
      },
    }));
  } catch (err) {
    return {
      ...created,
      note: `Fakturan skapades men betalningen (${paymentCode}) kunde inte registreras: ${err.message}`,
    };
  }
  // Bokförs betalningar automatiskt i Fortnox är den redan bokförd — då
  // är det inget fel.
  if (!payment?.InvoicePayment?.Booked) {
    try {
      await fortnoxRequest(current, `/invoicepayments/${payment.InvoicePayment.Number}/bookkeep`, { method: "PUT", body: {} });
    } catch (err) {
      return { ...created, note: `Betald med ${paymentCode}, men betalningen kunde inte bokföras: ${err.message}` };
    }
  }
  return created;
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
