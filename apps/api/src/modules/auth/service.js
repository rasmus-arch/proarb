import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";

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
