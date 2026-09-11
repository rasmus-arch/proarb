// Fortnox integration — deliberately a stub for now. The user asked for
// the payment-method-triggered invoice behaviour to be built (POS:
// betalmetod "Faktura" -> kundfaktura i Fortnox, "Swish" -> kontantfaktura
// i Fortnox) but explicitly wants the live API connection to wait until a
// Fortnox test environment/credentials exist. See PLAN.md Fas 7.
//
// Everything upstream (pos/service.js creating `invoices` rows with
// status PENDING) is real and already works; only the two functions below
// need to be filled in with actual Fortnox API calls once credentials are
// available (FORTNOX_ACCESS_TOKEN / FORTNOX_CLIENT_SECRET env vars, or
// however the eventual OAuth flow is wired up).

const FORTNOX_CONFIGURED = Boolean(process.env.FORTNOX_ACCESS_TOKEN);

function notConfigured() {
  return { ok: false, reason: "NOT_CONFIGURED", note: "Fortnox är inte konfigurerat ännu." };
}

// Fortnox "Invoice" against a known customer. Called when a POS sale (or
// order) is paid/invoiced with method INVOICE.
// TODO (Fas 7, after test environment exists): POST to Fortnox's
// /3/invoices endpoint using the customer's Fortnox CustomerNumber
// (needs a customers.fortnox_customer_number column once we get there),
// then return { ok: true, invoiceNumber, externalRef }.
export async function createCustomerInvoice(/* { customerId, amount, reference } */) {
  if (!FORTNOX_CONFIGURED) return notConfigured();
  throw new Error("Fortnox customer invoice creation not implemented yet");
}

// Fortnox "kontantfaktura" (cash invoice, no customer required) — used
// for Swish payments per the user's spec.
// TODO (Fas 7): POST to Fortnox's cash invoice endpoint.
export async function createCashInvoice(/* { amount, reference } */) {
  if (!FORTNOX_CONFIGURED) return notConfigured();
  throw new Error("Fortnox cash invoice creation not implemented yet");
}

export const isFortnoxConfigured = () => FORTNOX_CONFIGURED;
