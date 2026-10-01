import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { fetchAllFortnoxCustomers, isFortnoxConfigured, pushCustomerToFortnox } from "../integrations/fortnox.js";

// Kundsynk mellan Fokus och Fortnox.
//  - importCustomersFromFortnox: hämtar alla kunder i Fortnox. Varje
//    Fortnox-kund kopplas till en befintlig Fokus-kund (samma Fortnox-
//    kundnummer, annars samma organisationsnummer, annars exakt samma
//    namn) och får Fortnox-uppgifterna; annars skapas den i Fokus med samma
//    kundnummer som i Fortnox. Kan köras om när som helst.
//  - syncCustomerToFortnox: körs när en kund sparas/skapas i Fokus och
//    skickar ändringen till Fortnox.

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const nameKey = (value) => String(value ?? "").trim().toLowerCase();
const clean = (value) => {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
};

export async function importCustomersFromFortnox() {
  const settings = await getSettings();
  if (!isFortnoxConfigured(settings)) throw new Error("NOT_CONFIGURED");
  const { customers: remote } = await fetchAllFortnoxCustomers(settings);

  const [local] = await pool.query(
    `SELECT id, customer_number, name, org_number, fortnox_customer_number FROM customers WHERE active = 1`
  );
  const [allNumbers] = await pool.query(`SELECT customer_number FROM customers`);
  const usedNumbers = new Set(allNumbers.map((r) => String(r.customer_number)));

  const byFortnoxNumber = new Map();
  const byOrg = new Map();
  const byName = new Map();
  for (const c of local) {
    if (c.fortnox_customer_number) {
      byFortnoxNumber.set(String(c.fortnox_customer_number), c);
      continue;
    }
    const org = digits(c.org_number).slice(-10);
    if (org.length === 10 && !byOrg.has(org)) byOrg.set(org, c);
    if (!byName.has(nameKey(c.name))) byName.set(nameKey(c.name), c);
  }
  const taken = new Set();

  const result = { total: remote.length, created: 0, linked: 0, updated: 0, skipped: 0 };
  for (const r of remote) {
    const number = String(r.CustomerNumber);
    const org = digits(r.OrganisationNumber).slice(-10);
    let match = byFortnoxNumber.get(number);
    if (!match && org.length === 10) match = byOrg.get(org);
    if (!match) match = byName.get(nameKey(r.Name));
    if (match && taken.has(match.id)) match = null;

    // Inaktiva kunder i Fortnox hämtas bara om de redan finns i Fokus.
    if (!match && r.Active === false) {
      result.skipped++;
      continue;
    }

    const fields = {
      name: clean(r.Name),
      org_number: clean(r.OrganisationNumber),
      email: clean(r.Email),
      phone: clean(r.Phone ?? r.Phone1),
      address: clean(r.Address1),
      postal_code: clean(r.ZipCode),
      city: clean(r.City),
    };

    if (match) {
      taken.add(match.id);
      // Fortnox-uppgifterna gäller; tomma fält i Fortnox skriver inte över Fokus.
      const entries = Object.entries(fields).filter(([, v]) => v !== null);
      const sets = [...entries.map(([k]) => `${k} = ?`), "fortnox_customer_number = ?"];
      await pool.query(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`, [
        ...entries.map(([, v]) => v),
        number,
        match.id,
      ]);
      if (match.fortnox_customer_number) result.updated++;
      else result.linked++;
      continue;
    }

    const customerNumber = usedNumbers.has(number) ? `FN-${number}` : number;
    usedNumbers.add(customerNumber);
    await pool.query(
      `INSERT INTO customers (customer_number, name, org_number, email, phone, address, postal_code, city, fortnox_customer_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerNumber,
        fields.name ?? `Fortnox-kund ${number}`,
        fields.org_number,
        fields.email,
        fields.phone,
        fields.address,
        fields.postal_code,
        fields.city,
        number,
      ]
    );
    result.created++;
  }
  return result;
}

// Best-effort: ett fel här stoppar aldrig själva sparningen i Fokus, men
// rapporteras tillbaka så att det syns på kundsidan.
export async function syncCustomerToFortnox(customerId) {
  const settings = await getSettings();
  if (!isFortnoxConfigured(settings)) return null;
  try {
    const result = await pushCustomerToFortnox({ settings, customerId });
    return { synced: true, customerNumber: result.customerNumber };
  } catch (err) {
    return { synced: false, reason: err.message };
  }
}
