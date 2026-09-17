// Fortnox integration — deliberately a stub for now. The user asked for
// the payment-method-triggered invoice behaviour to be built (POS:
// betalmetod "Faktura" -> kundfaktura i Fortnox, "Swish" -> kontantfaktura
// i Fortnox) but explicitly wants the live API connection to wait until a
// Fortnox test environment/credentials exist. See PLAN.md Fas 7.
//
// Credentials live in app_settings (fortnox_client_id/client_secret/
// access_token/refresh_token) — filled in under Inställningar whenever a
// Fortnox app/test environment is ready — rather than env vars, so staff
// can set this up themselves without a redeploy. Every caller already
// fetches `settings` (getSettings()) for other reasons and just passes it
// through.
//
// Everything upstream (pos/service.js creating `invoices` rows with
// status PENDING) is real and already works; only the functions below
// need to be filled in with actual Fortnox API calls once credentials
// are available.

export function isFortnoxConfigured(settings) {
  return Boolean(settings?.fortnox_access_token);
}

function notConfigured() {
  return { ok: false, reason: "NOT_CONFIGURED", note: "Fortnox är inte konfigurerat ännu." };
}

// Fortnox "Invoice" against a known customer. Called when a POS sale (or
// order) is paid/invoiced with method INVOICE.
// TODO (Fas 7, after test environment exists): POST to Fortnox's
// /3/invoices endpoint using settings.fortnox_access_token and the
// customer's Fortnox CustomerNumber (needs a
// customers.fortnox_customer_number column once we get there), then
// return { ok: true, invoiceNumber, externalRef }.
export async function createCustomerInvoice(/* { settings, customerId, amount, reference } */ { settings } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  throw new Error("Fortnox customer invoice creation not implemented yet");
}

// Fortnox "kontantfaktura" (cash invoice, no customer required) — used
// for Swish payments per the user's spec.
// TODO (Fas 7): POST to Fortnox's cash invoice endpoint.
export async function createCashInvoice(/* { settings, amount, reference } */ { settings } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  throw new Error("Fortnox cash invoice creation not implemented yet");
}

// Fortnox "send invoice" action — emails an already-created invoice (see
// createCustomerInvoice above) to the customer from Fortnox. Called when
// an order is marked "Fakturerad".
// TODO (Fas 7, after test environment exists): POST to Fortnox's
// /3/invoices/{DocumentNumber}/externalprint (or /email) endpoint.
export async function sendCustomerInvoice(/* { settings, externalRef, invoiceNumber } */ { settings } = {}) {
  if (!isFortnoxConfigured(settings)) return notConfigured();
  throw new Error("Fortnox invoice sending not implemented yet");
}
