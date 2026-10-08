import { pool } from "../../lib/db.js";
import { sqlLineTotal } from "../../lib/lines.js";
import { getSettings } from "../settings/service.js";
import { fetchUnpaidInvoices, isFortnoxConfigured } from "../integrations/fortnox.js";

// Betalstatus från Fortnox och kreditgräns per kund.
//
// Obetalda fakturor hämtas från Fortnox till fortnox_unpaid_invoices (hela
// listan ersätts) när någon tittar och senaste hämtningen är äldre än
// STALE_MINUTES — Fortnox frågas alltså aldrig vid varje sidvisning.
// Kopplingen till kunden går via customers.fortnox_customer_number.

const STALE_MINUTES = 30;
let refreshing = null;

function paymentStatusActive(settings) {
  return Boolean(settings?.fortnox_payment_status_enabled) && isFortnoxConfigured(settings) && Boolean(settings?.fortnox_access_token);
}

async function doRefresh(settings) {
  const invoices = await fetchUnpaidInvoices(settings);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM fortnox_unpaid_invoices`);
    if (invoices.length > 0) {
      await connection.query(
        `INSERT INTO fortnox_unpaid_invoices (document_number, customer_number, invoice_date, due_date, total, balance) VALUES ?`,
        [invoices.map((i) => [i.documentNumber, i.customerNumber, i.invoiceDate, i.dueDate, i.total, i.balance])]
      );
    }
    await connection.query(`UPDATE app_settings SET fortnox_unpaid_synced_at = NOW() WHERE id = 1`);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  return invoices.length;
}

// Returnerar { ok, count } eller { ok: false, error }. Aldrig ett kastat fel —
// en Fortnox som inte svarar ska bara ge gammal data, inte en trasig sida.
export async function refreshUnpaidInvoices({ force = false } = {}) {
  const settings = await getSettings();
  if (!paymentStatusActive(settings)) return { ok: false, error: "NOT_ACTIVE" };
  if (!force && settings.fortnox_unpaid_synced_at) {
    const ageMinutes = (Date.now() - new Date(settings.fortnox_unpaid_synced_at).getTime()) / 60000;
    if (ageMinutes < STALE_MINUTES) return { ok: true, cached: true };
  }
  // Två samtidiga sidvisningar ska inte hämta listan två gånger.
  refreshing ??= doRefresh(settings).finally(() => {
    refreshing = null;
  });
  try {
    return { ok: true, count: await refreshing };
  } catch (err) {
    console.warn(`Betalstatus från Fortnox kunde inte hämtas: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// Ordrar som ännu inte är fakturerade i Fortnox (inkl moms): öppna och
// utlämnade utan en synkad faktura. Fakturerade ordrar räknas istället via
// Fortnox obetalda fakturor ovan, så inget räknas två gånger.
async function uninvoicedOrdersTotal(customerId, excludeOrderId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(${sqlLineTotal("ol")} * (1 + COALESCE(p.tax_rate_percent, ol.tax_rate_percent, 25) / 100)), 0) AS total,
            COUNT(DISTINCT o.id) AS order_count
     FROM orders o
     JOIN order_lines ol ON ol.order_id = o.id
     LEFT JOIN product_variants v ON v.id = ol.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE o.customer_id = ? AND o.id <> ?
       AND o.status IN ('NEW', 'READY_FOR_PICKUP', 'DELIVERED')
       AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'SYNCED' AND i.external_ref IS NOT NULL)`,
    [customerId, excludeOrderId ?? 0]
  );
  return { total: Math.round(Number(row.total) * 100) / 100, orderCount: Number(row.order_count) };
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Allt om en kunds betalningar och kredit — används av kundsidan och av
// order-editorn (med orderId för att inte räkna ordern själv två gånger).
export async function getCustomerCreditStatus(customerId, { orderId } = {}) {
  const settings = await getSettings();
  const [[customer]] = await pool.query(
    `SELECT id, fortnox_customer_number, credit_limit, is_cash_customer FROM customers WHERE id = ?`,
    [customerId]
  );
  if (!customer) return null;

  const payments = { enabled: paymentStatusActive(settings), synced_at: null, invoices: [], unpaid_total: 0, overdue_total: 0, overdue_count: 0 };
  if (payments.enabled) {
    await refreshUnpaidInvoices();
    const [[fresh]] = await pool.query(`SELECT fortnox_unpaid_synced_at FROM app_settings WHERE id = 1`);
    payments.synced_at = fresh?.fortnox_unpaid_synced_at ?? null;
    if (customer.fortnox_customer_number) {
      const [invoices] = await pool.query(
        `SELECT document_number, DATE_FORMAT(invoice_date, '%Y-%m-%d') AS invoice_date,
                DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, total, balance,
                (due_date IS NOT NULL AND due_date < CURDATE()) AS overdue,
                GREATEST(DATEDIFF(CURDATE(), due_date), 0) AS days_overdue
         FROM fortnox_unpaid_invoices WHERE customer_number = ? AND balance > 0 ORDER BY due_date ASC`,
        [customer.fortnox_customer_number]
      );
      payments.invoices = invoices.map((i) => ({ ...i, overdue: Boolean(i.overdue), total: Number(i.total), balance: Number(i.balance) }));
      payments.unpaid_total = round2(payments.invoices.reduce((s, i) => s + i.balance, 0));
      const overdue = payments.invoices.filter((i) => i.overdue);
      payments.overdue_total = round2(overdue.reduce((s, i) => s + i.balance, 0));
      payments.overdue_count = overdue.length;
    }
  }

  let credit = { enabled: Boolean(settings?.credit_limits_enabled), limit: null };
  if (credit.enabled && customer.credit_limit !== null && !customer.is_cash_customer) {
    const open = await uninvoicedOrdersTotal(customer.id, orderId);
    const used = round2(payments.unpaid_total + open.total);
    credit = {
      enabled: true,
      limit: Number(customer.credit_limit),
      unpaid_invoices: payments.unpaid_total,
      open_orders: open.total,
      open_order_count: open.orderCount,
      used,
      available: round2(Number(customer.credit_limit) - used),
    };
  }

  return { payments, credit };
}

// Översikt: alla kunder med förfallna fakturor.
export async function getOverduePaymentsOverview() {
  const settings = await getSettings();
  if (!paymentStatusActive(settings)) return { enabled: false };
  await refreshUnpaidInvoices();
  const [rows] = await pool.query(
    `SELECT c.id AS customer_id, COALESCE(c.name, CONCAT('Fortnox-kund ', f.customer_number)) AS customer_name,
            COUNT(*) AS invoice_count, SUM(f.balance) AS overdue_total,
            MAX(DATEDIFF(CURDATE(), f.due_date)) AS max_days_overdue
     FROM fortnox_unpaid_invoices f
     LEFT JOIN customers c ON c.fortnox_customer_number = f.customer_number
     WHERE f.balance > 0 AND f.due_date < CURDATE()
     GROUP BY f.customer_number, c.id, c.name
     ORDER BY overdue_total DESC`
  );
  const [[totals]] = await pool.query(
    `SELECT COALESCE(SUM(balance), 0) AS unpaid_total,
            COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue_total
     FROM fortnox_unpaid_invoices WHERE balance > 0`
  );
  const [[fresh]] = await pool.query(`SELECT fortnox_unpaid_synced_at FROM app_settings WHERE id = 1`);
  return {
    enabled: true,
    synced_at: fresh?.fortnox_unpaid_synced_at ?? null,
    unpaid_total: round2(totals.unpaid_total),
    overdue_total: round2(totals.overdue_total),
    customers: rows.map((r) => ({
      ...r,
      invoice_count: Number(r.invoice_count),
      overdue_total: round2(r.overdue_total),
      max_days_overdue: Number(r.max_days_overdue),
    })),
  };
}
