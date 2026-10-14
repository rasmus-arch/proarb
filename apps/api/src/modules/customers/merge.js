import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { deactivateFortnoxCustomer, isFortnoxConfigured } from "../integrations/fortnox.js";
import { syncCustomerToFortnox } from "./fortnox-sync.js";

// Slå ihop två kunder: allt som hör till "source" flyttas till "target" och
// source döljs. I Fortnox kan fakturor inte flyttas mellan kunder, så där
// inaktiveras den gamla kunden (om man vill) och den kvarvarande uppdateras.

// Tabeller med kolumnen customer_id som kan flyttas rakt av.
const MOVE_TABLES = [
  ["orders", "Ordrar"],
  ["quotes", "Offerter"],
  ["customer_contacts", "Kontakter"],
  ["customer_logos", "Loggor"],
  ["customer_discounts", "Rabatter"],
  ["order_templates", "Ordermallar"],
  ["portal_order_requests", "Sortilog-beställningar"],
  ["portal_accounts", "Sortilog-konton"],
  ["sales", "Gamla kassaköp"],
];

async function loadPair(db, sourceId, targetId) {
  if (!sourceId || !targetId || Number(sourceId) === Number(targetId)) throw new Error("MERGE_SAME_CUSTOMER");
  const [rows] = await db.query(`SELECT * FROM customers WHERE id IN (?, ?)`, [sourceId, targetId]);
  const source = rows.find((r) => r.id === Number(sourceId));
  const target = rows.find((r) => r.id === Number(targetId));
  if (!source || !target) throw new Error("CUSTOMER_NOT_FOUND");
  if (source.is_cash_customer || target.is_cash_customer) throw new Error("MERGE_CASH_CUSTOMER");
  return { source, target };
}

export async function previewMerge(sourceId, targetId) {
  const { source, target } = await loadPair(pool, sourceId, targetId);
  const counts = [];
  for (const [table, label] of [...MOVE_TABLES, ["customer_assortment", "Sortiment"]]) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE customer_id = ?`, [sourceId]);
    if (Number(row.n) > 0) counts.push({ label, count: Number(row.n) });
  }
  return {
    source: { id: source.id, name: source.name, customer_number: source.customer_number, fortnox_customer_number: source.fortnox_customer_number },
    target: { id: target.id, name: target.name, customer_number: target.customer_number, fortnox_customer_number: target.fortnox_customer_number },
    moves: counts,
  };
}

export async function mergeCustomers(sourceId, targetId, { deactivateInFortnox = true } = {}) {
  const connection = await pool.getConnection();
  let source;
  let target;
  let movedFortnox = false;
  try {
    await connection.beginTransaction();
    ({ source, target } = await loadPair(connection, sourceId, targetId));

    for (const [table] of MOVE_TABLES) {
      await connection.query(`UPDATE ${table} SET customer_id = ? WHERE customer_id = ?`, [target.id, source.id]);
    }
    // Sortimentet har unik nyckel (kund, produkt): målets egna rader gäller.
    await connection.query(`UPDATE IGNORE customer_assortment SET customer_id = ? WHERE customer_id = ?`, [target.id, source.id]);
    await connection.query(`DELETE FROM customer_assortment WHERE customer_id = ?`, [source.id]);

    // Tomma fält hos målet fylls på från den gamla kunden.
    const fill = ["org_number", "email", "invoice_email", "phone", "address", "postal_code", "city", "credit_limit", "price_list_id", "logo_url"];
    const sets = fill.map((f) => `${f} = COALESCE(NULLIF(${f}, ''), ?)`).join(", ");
    const note = `Sammanslagen med ${source.name} (kundnr ${source.customer_number}) ${new Date().toISOString().slice(0, 10)}.`;
    // Fortnox-kopplingen flyttas om målet saknar en (annars behåller målet sin).
    const moveFortnox = !target.fortnox_customer_number && source.fortnox_customer_number;
    await connection.query(
      `UPDATE customers SET ${sets}, fortnox_customer_number = COALESCE(fortnox_customer_number, ?),
         notes = CONCAT_WS('\n', NULLIF(notes, ''), ?) WHERE id = ?`,
      [...fill.map((f) => source[f] ?? null), source.fortnox_customer_number ?? null, note, target.id]
    );

    await connection.query(
      `UPDATE customers SET active = 0, portal_token = NULL,
         ${moveFortnox ? "fortnox_customer_number = NULL," : ""}
         notes = CONCAT_WS('\n', NULLIF(notes, ''), ?) WHERE id = ?`,
      [`Sammanslagen i ${target.name} (kundnr ${target.customer_number}) ${new Date().toISOString().slice(0, 10)}.`, source.id]
    );
    await connection.commit();
    movedFortnox = Boolean(moveFortnox);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  // Fortnox (best-effort — Fokus-sammanslagningen är redan klar).
  const fortnox = { target: null, source: null };
  const settings = await getSettings();
  if (isFortnoxConfigured(settings)) {
    fortnox.target = await syncCustomerToFortnox(target.id);
    if (source.fortnox_customer_number && !movedFortnox && source.fortnox_customer_number !== target.fortnox_customer_number) {
      if (deactivateInFortnox) {
        try {
          await deactivateFortnoxCustomer({ settings, customerNumber: source.fortnox_customer_number });
          fortnox.source = { deactivated: true, customerNumber: source.fortnox_customer_number };
        } catch (err) {
          fortnox.source = { deactivated: false, customerNumber: source.fortnox_customer_number, reason: err.message };
        }
      } else {
        fortnox.source = { deactivated: false, customerNumber: source.fortnox_customer_number, skipped: true };
      }
    }
  }
  return { targetId: target.id, fortnox, movedFortnoxNumber: movedFortnox };
}
