import { pool } from "../../lib/db.js";

// Resolves a category/brand name to its id, creating the row if it
// doesn't exist yet. Shared by the "new product" form and the CSV
// bulk importer so both can accept free-text category/brand names.
export async function resolveNameToId(table, name) {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const [[existing]] = await pool.query(`SELECT id FROM ${table} WHERE name = ?`, [trimmed]);
  if (existing) return existing.id;

  const [result] = await pool.query(`INSERT INTO ${table} (name) VALUES (?)`, [trimmed]);
  return result.insertId;
}
