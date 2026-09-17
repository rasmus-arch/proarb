// Outbound email — deliberately a stub for now, same reasoning as
// fortnox.js: the behaviour (send a notification when an order is marked
// "Redo för utlämning") is built end-to-end, but no SMTP provider is
// connected anywhere in this app yet. Fill in the function below with a
// real SMTP send (e.g. nodemailer) once SMTP_HOST/SMTP_USER/SMTP_PASSWORD
// (or whatever the eventual provider needs) are available as env vars.

const EMAIL_CONFIGURED = Boolean(process.env.SMTP_HOST);

function notConfigured() {
  return { ok: false, reason: "NOT_CONFIGURED", note: "E-post är inte konfigurerat ännu." };
}

// Called when staff marks an order "Redo för utlämning" with the
// "skicka mail" option checked.
// TODO: once SMTP is configured, send an email to `to` and return
// { ok: true }.
export async function sendOrderReadyEmail(/* { to, customerName, orderNumber } */) {
  if (!EMAIL_CONFIGURED) return notConfigured();
  throw new Error("Email sending not implemented yet");
}

export const isEmailConfigured = () => EMAIL_CONFIGURED;
