import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { sendPasswordResetEmail } from "../integrations/email.js";
import { assertPasswordStrength as assertStrongPassword, sha256 } from "../../lib/security.js";

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MINUTES = 60;

function hashToken(token) {
  return sha256(token);
}

function assertPasswordStrength(password) {
  assertStrongPassword(password);
}

// Jämförs mot när kontot saknas, så att svarstiden inte avslöjar vilka
// e-postadresser som har konton.
const DUMMY_HASH = bcrypt.hashSync("proarb-dummy-password", SALT_ROUNDS);

// Byter eget lösenord. Loggar ut alla andra sessioner för kontot, men
// behåller den som gjorde bytet.
export async function changePassword(userId, currentSessionToken, { currentPassword, newPassword }) {
  const [[user]] = await pool.query(`SELECT password_hash FROM users WHERE id = ? AND active = 1`, [userId]);
  if (!user || !(await bcrypt.compare(String(currentPassword ?? ""), user.password_hash))) {
    throw new Error("WRONG_PASSWORD");
  }
  assertPasswordStrength(newPassword);
  if (newPassword === currentPassword) {
    const err = new Error("WEAK_PASSWORD");
    err.detail = "Välj ett nytt lösenord, inte samma som det gamla.";
    throw err;
  }
  await pool.query(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [
    await bcrypt.hash(newPassword, SALT_ROUNDS),
    userId,
  ]);
  await pool.query(`DELETE FROM sessions WHERE user_id = ? AND token <> ?`, [userId, hashToken(currentSessionToken ?? "")]);
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
  await pool.query(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [
    await bcrypt.hash(newPassword, SALT_ROUNDS),
    reset.user_id,
  ]);
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
  const valid = await bcrypt.compare(String(password ?? ""), user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) return null;

  // Bara en hash av sessionsnyckeln sparas — läcker databasen (t.ex. en
  // säkerhetskopia) går det ändå inte att logga in med den.
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, [
    hashToken(token),
    user.id,
    expiresAt,
  ]);
  await pool.query(`DELETE FROM sessions WHERE expires_at < NOW()`);

  return { token, expiresAt, user: toPublicUser(user) };
}

export async function logout(token) {
  await pool.query(`DELETE FROM sessions WHERE token = ?`, [hashToken(token)]);
}

export async function getUserBySessionToken(token) {
  if (!token) return null;
  const [[row]] = await pool.query(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > NOW() AND u.active = 1`,
    [hashToken(token)]
  );
  return row ? toPublicUser(row) : null;
}

export function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
  };
}

// Konton som fortfarande har standardlösenordet ("changeme" från
// seed.sql) måste byta lösenord innan de kan använda systemet. Körs vid start.
export async function flagDefaultPasswords() {
  const [users] = await pool.query(`SELECT id, password_hash FROM users WHERE active = 1 AND must_change_password = 0`);
  for (const user of users) {
    if (await bcrypt.compare("changeme", user.password_hash)) {
      await pool.query(`UPDATE users SET must_change_password = 1 WHERE id = ?`, [user.id]);
      console.warn(`Användare ${user.id} har standardlösenordet och måste byta det vid inloggning.`);
    }
  }
}
