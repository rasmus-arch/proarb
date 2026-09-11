import { pool } from "@proarb/db";

export async function getSettings() {
  const [[settings]] = await pool.query(`SELECT * FROM app_settings WHERE id = 1`);
  return settings;
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
