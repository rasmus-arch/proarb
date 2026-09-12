import bcrypt from "bcryptjs";
import { pool } from "../../lib/db.js";

const SALT_ROUNDS = 10;

export async function listUsers() {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users ORDER BY name ASC`
  );
  return rows;
}

export async function createUser({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
    [name, email, passwordHash, role ?? "SALES"]
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
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id]);
  }

  const [[user]] = await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users WHERE id = ?`,
    [id]
  );
  return user ?? null;
}
