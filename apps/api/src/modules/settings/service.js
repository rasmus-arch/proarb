import { pool } from "../../lib/db.js";

export async function getSettings() {
  const [[settings]] = await pool.query(`SELECT * FROM app_settings WHERE id = 1`);
  return settings;
}

// Small, non-sensitive subset of getSettings() — shown in the nav header
// (nav.js) to every logged-in role, unlike the full settings page which is
// ADMIN-only. Also carries the couple of behavior flags every role's own
// pages need to read (inaktivitetslistan, auto-utskrift) — none of them
// are sensitive, unlike SMTP/Fortnox credentials in getSettings().
export async function getBranding() {
  const [[branding]] = await pool.query(
    `SELECT seller_name, seller_logo_path, inactive_customer_months, auto_print_order_slip FROM app_settings WHERE id = 1`
  );
  return branding;
}

export async function updateSettings(data) {
  const fields = {
    seller_name: data.sellerName,
    seller_org_number: data.sellerOrgNumber,
    seller_address: data.sellerAddress,
    seller_postal_code: data.sellerPostalCode,
    seller_city: data.sellerCity,
    seller_email: data.sellerEmail,
    seller_phone: data.sellerPhone,
    brand_color: data.brandColor,
    quote_footer_note: data.quoteFooterNote,
    reminder_enabled: data.reminderEnabled === undefined ? undefined : data.reminderEnabled ? 1 : 0,
    reminder_days_after: data.reminderDaysAfter,
    portal_show_stock: data.portalShowStock === undefined ? undefined : data.portalShowStock ? 1 : 0,
    inactive_customer_months: data.inactiveCustomerMonths,
    auto_print_order_slip: data.autoPrintOrderSlip === undefined ? undefined : data.autoPrintOrderSlip ? 1 : 0,
    next_order_number: data.nextOrderNumber,
    next_quote_number: data.nextQuoteNumber,
    smtp_host: data.smtpHost,
    smtp_port: data.smtpPort,
    smtp_username: data.smtpUsername,
    smtp_password: data.smtpPassword,
    smtp_from_email: data.smtpFromEmail,
    smtp_use_tls: data.smtpUseTls === undefined ? undefined : data.smtpUseTls ? 1 : 0,
    fortnox_client_id: data.fortnoxClientId,
    fortnox_client_secret: data.fortnoxClientSecret,
    fortnox_access_token: data.fortnoxAccessToken,
    fortnox_refresh_token: data.fortnoxRefreshToken,
  };

  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length > 0) {
    const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await pool.query(`UPDATE app_settings SET ${setClause} WHERE id = 1`, values);
  }

  return getSettings();
}

export async function updateSellerLogo(filePath) {
  await pool.query(`UPDATE app_settings SET seller_logo_path = ? WHERE id = 1`, [filePath]);
  return getSettings();
}
