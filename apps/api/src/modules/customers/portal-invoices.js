import { pool } from "../../lib/db.js";
import { getSettings } from "../settings/service.js";
import { fetchInvoicePdf } from "../integrations/fortnox.js";

// Fakturor i Sortilog: kundens fakturor som finns i Fortnox, med status
// (betald / obetald / förfallen) från betalstatusen (payment-status.js).
// Visas och laddas ner bara av inloggade Sortilog-användare — aldrig via
// de gamla länkarna utan inloggning. Kontantfakturor (betalda på plats)
// tas inte med.

export async function listCustomerInvoices(customerId) {
  const [rows] = await pool.query(
    `SELECT i.id, i.type, i.invoice_number, i.amount, i.paid_at, i.created_at, o.order_number,
            DATE_FORMAT(f.due_date, '%Y-%m-%d') AS due_date, f.balance,
            (f.due_date IS NOT NULL AND f.due_date < CURDATE() AND f.balance > 0) AS overdue
     FROM invoices i
     JOIN orders o ON o.id = i.order_id
     LEFT JOIN fortnox_unpaid_invoices f ON f.document_number = i.external_ref
     WHERE o.customer_id = ? AND i.external_ref IS NOT NULL AND i.type IN ('CUSTOMER_INVOICE', 'CREDIT_INVOICE')
     ORDER BY i.created_at DESC
     LIMIT 50`,
    [customerId]
  );
  return rows.map((r) => ({ ...r, overdue: Boolean(r.overdue), balance: r.balance === null ? null : Number(r.balance) }));
}

// Kontrollerar att fakturan hör till kunden innan PDF:en hämtas.
export async function getCustomerInvoicePdf(customerId, invoiceId) {
  const [[invoice]] = await pool.query(
    `SELECT i.external_ref, i.invoice_number FROM invoices i JOIN orders o ON o.id = i.order_id
     WHERE i.id = ? AND o.customer_id = ? AND i.external_ref IS NOT NULL AND i.type IN ('CUSTOMER_INVOICE', 'CREDIT_INVOICE')`,
    [invoiceId, customerId]
  );
  if (!invoice) return null;
  const pdf = await fetchInvoicePdf(await getSettings(), invoice.external_ref);
  return { pdf, filename: `Faktura-${invoice.invoice_number ?? invoice.external_ref}.pdf` };
}
