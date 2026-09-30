import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { sendPasswordResetEmail } from "../integrations/email.js";

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MINUTES = 60;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function assertPasswordStrength(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw new Error("WEAK_PASSWORD");
}

// Byter eget lösenord. Loggar ut alla andra sessioner för kontot, men
// behåller den som gjorde bytet.
export async function changePassword(userId, currentSessionToken, { currentPassword, newPassword }) {
  const [[user]] = await pool.query(`SELECT password_hash FROM users WHERE id = ? AND active = 1`, [userId]);
  if (!user || !(await bcrypt.compare(String(currentPassword ?? ""), user.password_hash))) {
    throw new Error("WRONG_PASSWORD");
  }
  assertPasswordStrength(newPassword);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [await bcrypt.hash(newPassword, SALT_ROUNDS), userId]);
  await pool.query(`DELETE FROM sessions WHERE user_id = ? AND token <> ?`, [userId, currentSessionToken ?? ""]);
}

// Svarar alltid likadant utåt (se routes.js) — om e-postadressen finns
// eller inte ska inte gå att utläsa. Max en länk per 2 minuter per konto.
export async function requestPasswordReset(email, origin) {
  const [[user]] = await pool.query(`SELECT id, name, email FROM users WHERE email = ? AND active = 1`, [
    String(email ?? "").trim(),
  ]);
  if (!user) return;
  const [[recent]] = await pool.query(
    `SELECT id FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
    [user.id]
  );
  if (recent) return;

  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [user.id, hashToken(token), RESET_TTL_MINUTES]
  );
  const settings = await getSettings();
  await sendPasswordResetEmail({
    settings,
    to: user.email,
    name: user.name,
    resetUrl: `${origin}/reset-password.html?token=${token}`,
    validMinutes: RESET_TTL_MINUTES,
  });
}

export async function resetPassword(token, newPassword) {
  assertPasswordStrength(newPassword);
  const [[reset]] = await pool.query(
    `SELECT id, user_id FROM password_resets
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
    [hashToken(String(token ?? ""))]
  );
  if (!reset) throw new Error("INVALID_TOKEN");
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [await bcrypt.hash(newPassword, SALT_ROUNDS), reset.user_id]);
  await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`, [reset.user_id]);
  await pool.query(`DELETE FROM sessions WHERE user_id = ?`, [reset.user_id]);
}

const SESSION_TTL_DAYS = 30;

export function newSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function login(email, password) {
  const [[user]] = await pool.query(
    `SELECT * FROM users WHERE email = ? AND active = 1`,
    [email]
  );
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, [
    token,
    user.id,
    expiresAt,
  ]);

  return { token, expiresAt, user: toPublicUser(user) };
}

export async function logout(token) {
  await pool.query(`DELETE FROM sessions WHERE token = ?`, [token]);
}

export async function getUserBySessionToken(token) {
  if (!token) return null;
  const [[row]] = await pool.query(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > NOW() AND u.active = 1`,
    [token]
  );
  return row ? toPublicUser(row) : null;
}

export function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
