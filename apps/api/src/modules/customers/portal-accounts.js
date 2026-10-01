import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { sendPortalInviteEmail, sendPortalPasswordResetEmail } from "../integrations/email.js";
import { getOrCreatePortalToken } from "./service.js";

// Sortilog-inloggning: ett konto per person hos kunden (e-post + lösenord).
// Personalen skapar kontot och en inbjudan skickas; personen väljer sitt
// lösenord via en engångslänk. Samma principer som personalens inloggning
// (auth/service.js) — bcrypt, minst 8 tecken, svar som inte avslöjar om en
// e-postadress finns — men egna tabeller, eftersom ett kundkonto aldrig ska
// kunna nå något i själva systemet.

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const SESSION_TTL_DAYS = 30;
const INVITE_TTL_HOURS = 7 * 24;
const RESET_TTL_HOURS = 1;
// Jämförs mot när kontot saknas, så att svarstiden inte avslöjar vilka
// e-postadresser som finns.
const DUMMY_HASH = bcrypt.hashSync("sortilog-dummy-password", SALT_ROUNDS);

export const PORTAL_SESSION_COOKIE = "sortilog_session";
export const PORTAL_SESSION_MAX_AGE_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function publicAccount(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    email: row.email,
    name: row.name,
    active: Boolean(row.active),
    has_password: Boolean(row.password_hash),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

// --- Personalens sida (kund-editorn) ---------------------------------------

export async function listAccounts(customerId) {
  const [rows] = await pool.query(
    `SELECT * FROM portal_accounts WHERE customer_id = ? AND active = 1 ORDER BY name ASC, email ASC`,
    [customerId]
  );
  return rows.map(publicAccount);
}

async function issuePasswordToken(accountId, purpose) {
  const token = crypto.randomBytes(32).toString("hex");
  const hours = purpose === "INVITE" ? INVITE_TTL_HOURS : RESET_TTL_HOURS;
  await pool.query(
    `INSERT INTO portal_password_tokens (account_id, token_hash, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [accountId, hashToken(token), purpose, hours]
  );
  return token;
}

// Skickar inbjudan. Går mejlet inte iväg (t.ex. SMTP inte inställt)
// returneras länken så att personalen kan skicka den själv.
async function sendInvite(account, origin) {
  const token = await issuePasswordToken(account.id, "INVITE");
  const url = `${origin}/sortilog/losenord?token=${token}`;
  const [[customer]] = await pool.query(`SELECT name FROM customers WHERE id = ?`, [account.customer_id]);
  let result;
  try {
    result = await sendPortalInviteEmail({
      settings: await getSettings(),
      to: account.email,
      name: account.name,
      customerName: customer?.name,
      url,
      validDays: INVITE_TTL_HOURS / 24,
    });
  } catch (err) {
    result = { ok: false, note: err.message };
  }
  return result.ok ? { sent: true } : { sent: false, reason: result.note ?? result.reason, inviteUrl: url };
}

export async function createAccount(customerId, { email, name }, origin) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("INVALID_EMAIL");

  const [[existing]] = await pool.query(`SELECT * FROM portal_accounts WHERE email = ?`, [normalized]);
  let accountId;
  if (existing && existing.active) throw new Error("EMAIL_TAKEN");
  if (existing) {
    // Ett tidigare borttaget konto med samma adress återanvänds (e-post är
    // unik) — men nollställs helt, även lösenordet.
    await pool.query(
      `UPDATE portal_accounts SET customer_id = ?, name = ?, password_hash = NULL, active = 1, last_login_at = NULL WHERE id = ?`,
      [customerId, name?.trim() || null, existing.id]
    );
    accountId = existing.id;
  } else {
    const [result] = await pool.query(`INSERT INTO portal_accounts (customer_id, email, name) VALUES (?, ?, ?)`, [
      customerId,
      normalized,
      name?.trim() || null,
    ]);
    accountId = result.insertId;
  }
  // Kunden behöver en portal_token — den inloggade sidan bygger på samma
  // sida/API som länkarna.
  await getOrCreatePortalToken(customerId);
  const [[account]] = await pool.query(`SELECT * FROM portal_accounts WHERE id = ?`, [accountId]);
  return { account: publicAccount(account), invite: await sendInvite(account, origin) };
}

export async function resendInvite(customerId, accountId, origin) {
  const [[account]] = await pool.query(
    `SELECT * FROM portal_accounts WHERE id = ? AND customer_id = ? AND active = 1`,
    [accountId, customerId]
  );
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  return sendInvite(account, origin);
}

export async function deactivateAccount(customerId, accountId) {
  await pool.query(`UPDATE portal_accounts SET active = 0 WHERE id = ? AND customer_id = ?`, [accountId, customerId]);
  await pool.query(`DELETE FROM portal_sessions WHERE account_id = ?`, [accountId]);
}

// När en kund tas bort stängs alla dess inloggningar.
export async function deactivateAccountsForCustomer(customerId) {
  await pool.query(
    `DELETE ps FROM portal_sessions ps JOIN portal_accounts pa ON pa.id = ps.account_id WHERE pa.customer_id = ?`,
    [customerId]
  );
  await pool.query(`UPDATE portal_accounts SET active = 0 WHERE customer_id = ?`, [customerId]);
}

// --- Kundens sida (/sortilog) ------------------------------------------------

export async function login(email, password) {
  const [[account]] = await pool.query(
    `SELECT pa.* FROM portal_accounts pa JOIN customers c ON c.id = pa.customer_id
     WHERE pa.email = ? AND pa.active = 1 AND c.active = 1`,
    [normalizeEmail(email)]
  );
  const valid = await bcrypt.compare(String(password ?? ""), account?.password_hash ?? DUMMY_HASH);
  if (!account?.password_hash || !valid) return null;

  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO portal_sessions (token_hash, account_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [hashToken(token), account.id, SESSION_TTL_DAYS]
  );
  await pool.query(`UPDATE portal_accounts SET last_login_at = NOW() WHERE id = ?`, [account.id]);
  return { token, account: publicAccount(account) };
}

export async function logout(token) {
  if (token) await pool.query(`DELETE FROM portal_sessions WHERE token_hash = ?`, [hashToken(token)]);
}

// Inloggat konto + kundens portal_token, eller null.
export async function getSessionAccount(token) {
  if (!token) return null;
  const [[row]] = await pool.query(
    `SELECT pa.*, c.portal_token FROM portal_sessions ps
     JOIN portal_accounts pa ON pa.id = ps.account_id
     JOIN customers c ON c.id = pa.customer_id
     WHERE ps.token_hash = ? AND ps.expires_at > NOW() AND pa.active = 1 AND c.active = 1`,
    [hashToken(token)]
  );
  if (!row) return null;
  const portalToken = row.portal_token ?? (await getOrCreatePortalToken(row.customer_id));
  return { ...publicAccount(row), portal_token: portalToken };
}

// Svarar alltid likadant utåt. Max en länk per 2 minuter per konto.
export async function requestPasswordReset(email, origin) {
  const [[account]] = await pool.query(
    `SELECT pa.* FROM portal_accounts pa JOIN customers c ON c.id = pa.customer_id
     WHERE pa.email = ? AND pa.active = 1 AND c.active = 1`,
    [normalizeEmail(email)]
  );
  if (!account) return;
  const [[recent]] = await pool.query(
    `SELECT id FROM portal_password_tokens WHERE account_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
    [account.id]
  );
  if (recent) return;
  const token = await issuePasswordToken(account.id, "RESET");
  await sendPortalPasswordResetEmail({
    settings: await getSettings(),
    to: account.email,
    name: account.name,
    url: `${origin}/sortilog/losenord?token=${token}`,
    validMinutes: RESET_TTL_HOURS * 60,
  });
}

export async function getPasswordToken(token) {
  const [[row]] = await pool.query(
    `SELECT t.purpose, pa.email, pa.name FROM portal_password_tokens t
     JOIN portal_accounts pa ON pa.id = t.account_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > NOW() AND pa.active = 1`,
    [hashToken(token)]
  );
  return row ?? null;
}

// Sätter lösenord via inbjudan eller återställning och loggar in direkt.
export async function setPassword(token, password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw new Error("WEAK_PASSWORD");
  const [[row]] = await pool.query(
    `SELECT t.account_id, pa.email FROM portal_password_tokens t
     JOIN portal_accounts pa ON pa.id = t.account_id
     WHERE t.token_hash = ? AND t.used_at IS NULL AND t.expires_at > NOW() AND pa.active = 1`,
    [hashToken(token)]
  );
  if (!row) throw new Error("INVALID_TOKEN");
  await pool.query(`UPDATE portal_accounts SET password_hash = ? WHERE id = ?`, [
    await bcrypt.hash(password, SALT_ROUNDS),
    row.account_id,
  ]);
  await pool.query(`UPDATE portal_password_tokens SET used_at = NOW() WHERE account_id = ? AND used_at IS NULL`, [
    row.account_id,
  ]);
  await pool.query(`DELETE FROM portal_sessions WHERE account_id = ?`, [row.account_id]);
  return login(row.email, password);
}
