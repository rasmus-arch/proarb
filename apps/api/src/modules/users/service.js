import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";
import { assertPasswordStrength } from "../../lib/security.js";

const SALT_ROUNDS = 10;

export async function listUsers() {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users ORDER BY name ASC`
  );
  return rows;
}

// Lösenord som en administratör satt måste användaren själv byta vid
// första inloggningen (must_change_password).
export async function createUser({ name, email, password, role }) {
  assertPasswordStrength(password);
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)`,
    [name, String(email).trim().toLowerCase(), passwordHash, role ?? "SALES"]
  );
  const [[user]] = await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users WHERE id = ?`,
    [result.insertId]
  );
  return user;
}

export async function updateUser(id, { name, role, active, password }) {
  const fields = {
    name,
    role,
    active: active === undefined ? undefined : active ? 1 : 0,
  };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);

  if (entries.length > 0) {
    const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await pool.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, id]);
  }

  if (password) {
    assertPasswordStrength(password);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, [passwordHash, id]);
  }
  // Nytt lösenord eller avstängd: alla inloggningar för kontot avslutas.
  if (password || active === false) await pool.query(`DELETE FROM sessions WHERE user_id = ?`, [id]);

  const [[user]] = await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users WHERE id = ?`,
    [id]
  );
  return user ?? null;
}
