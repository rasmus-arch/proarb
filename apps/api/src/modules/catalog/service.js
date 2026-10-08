import { pool } from "../../lib/db.js";

// Resolves a category/brand name to its id, creating the row if it
// doesn't exist yet. Shared by the "new product" form and the CSV
// bulk importer so both can accept free-text category/brand names.
// Tabellnamnet sätts in i SQL:en — bara de här är tillåtna (skydd även om
// en framtida anropare skulle skicka vidare indata).
const NAME_TABLES = new Set(["product_categories", "brands", "suppliers"]);

export async function resolveNameToId(table, name) {
  if (!NAME_TABLES.has(table)) throw new Error(`Otillåten tabell: ${table}`);
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const [[existing]] = await pool.query(`SELECT id FROM ${table} WHERE name = ?`, [trimmed]);
  if (existing) return existing.id;

  const [result] = await pool.query(`INSERT INTO ${table} (name) VALUES (?)`, [trimmed]);
  return result.insertId;
}
