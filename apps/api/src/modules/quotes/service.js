import crypto from "node:crypto";
import { pool } from "../../lib/db.js";
import { assertValidLines } from "../../lib/lines.js";
import { getSettings } from "../settings/service.js";
import { sendQuoteEmail } from "../integrations/email.js";

function nextQuoteNumber() {
  return `OFF-${Math.floor(Date.now() / 1000)}`;
}

function newPublicToken() {
  return crypto.randomBytes(24).toString("hex");
}

// unit_price * quantity * (1 - discount%) — always ex moms, per PLAN.md.
function lineTotal(line) {
  return Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
}

// null when the product has no cost_price set — margin for that line is
// simply unknown, not zero.
function lineMargin(line) {
  if (line.cost_price === null || line.cost_price === undefined) return null;
  return line.line_total - Number(line.quantity) * Number(line.cost_price);
}

export async function listQuotes({ search = "", status = "", page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;
  const statusClause = status ? "AND q.status = ?" : "";
  const params = status ? [like, like, status, pageSize, offset] : [like, like, pageSize, offset];
  const countParams = status ? [like, like, status] : [like, like];

  const [rows] = await pool.query(
    `SELECT q.id, q.quote_number, q.status, q.valid_until, q.created_at, q.sent_at,
            c.id AS customer_id, c.name AS customer_name,
            COALESCE(SUM(ql.quantity * ql.unit_price * (1 - ql.discount_percent / 100)), 0) AS total_amount
     FROM quotes q
     JOIN customers c ON c.id = q.customer_id
     LEFT JOIN quote_lines ql ON ql.quote_id = q.id
     WHERE (q.quote_number LIKE ? OR c.name LIKE ?) ${statusClause}
     GROUP BY q.id
     ORDER BY q.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM quotes q JOIN customers c ON c.id = q.customer_id
     WHERE (q.quote_number LIKE ? OR c.name LIKE ?) ${statusClause}`,
    countParams
  );

  return { rows, total, page, pageSize };
}

async function loadQuoteLines(quoteId) {
  // LEFT JOIN: a fritextrad (free-text line) has no product_variant_id, so
  // p/v come back all-NULL for it — COALESCE falls back to the line's own
  // description/tax_rate_percent in that case.
  const [lines] = await pool.query(
    `SELECT ql.*, COALESCE(p.name, ql.description) AS product_name,
            COALESCE(p.tax_rate_percent, ql.tax_rate_percent) AS tax_rate_percent,
            p.cost_price, v.sku, v.color, v.size, v.barcode, pm.name AS print_method_name
     FROM quote_lines ql
     LEFT JOIN product_variants v ON v.id = ql.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     LEFT JOIN print_methods pm ON pm.id = ql.print_method_id
     WHERE ql.quote_id = ?
     ORDER BY ql.sort_order ASC, ql.id ASC`,
    [quoteId]
  );

  return lines.map((line) => {
    const withTotal = { ...line, line_total: lineTotal(line) };
    return { ...withTotal, line_margin: lineMargin(withTotal) };
  });
}

function summarizeTotals(lines) {
  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
  const vat = lines.reduce((sum, l) => sum + l.line_total * (Number(l.tax_rate_percent) / 100), 0);
  const marginLines = lines.filter((l) => l.line_margin !== null && l.line_margin !== undefined);
  const marginAmount = marginLines.reduce((sum, l) => sum + l.line_margin, 0);

  return {
    subtotal_ex_vat: round2(subtotal),
    vat_amount: round2(vat),
    total_inc_vat: round2(subtotal + vat),
    margin_amount: round2(marginAmount),
    margin_percent: subtotal > 0 ? round2((marginAmount / subtotal) * 100) : 0,
    margin_incomplete: marginLines.length < lines.length,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function loadQuoteHeader(where, param) {
  const [[quote]] = await pool.query(
    `SELECT q.*, c.name AS customer_name, c.org_number AS customer_org_number, c.address AS customer_address,
            c.postal_code AS customer_postal_code, c.city AS customer_city, c.logo_url AS customer_logo_url,
            c.email AS customer_email, c.phone AS customer_phone,
            cc.name AS reference_name, cc.email AS reference_email, cc.phone AS reference_phone,
            u.name AS created_by_name
     FROM quotes q
     JOIN customers c ON c.id = q.customer_id
     LEFT JOIN customer_contacts cc ON cc.id = q.reference_contact_id
     LEFT JOIN users u ON u.id = q.created_by
     WHERE ${where} = ?`,
    [param]
  );
  return quote ?? null;
}

export async function getQuote(id) {
  const quote = await loadQuoteHeader("q.id", id);
  if (!quote) return null;
  const lines = await loadQuoteLines(id);
  const [events] = await pool.query(`SELECT * FROM quote_events WHERE quote_id = ? ORDER BY created_at ASC`, [id]);
  return { ...quote, lines, events, totals: summarizeTotals(lines) };
}

export async function getQuoteByToken(token) {
  const quote = await loadQuoteHeader("q.public_token", token);
  if (!quote) return null;
  const lines = await loadQuoteLines(quote.id);
  return { ...quote, lines, totals: summarizeTotals(lines) };
}

export async function createQuote(data, userId) {
  assertValidLines(data.lines ?? []);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO quotes (quote_number, customer_id, reference_contact_id, valid_until, public_token, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nextQuoteNumber(),
        data.customerId,
        data.referenceContactId ?? null,
        data.validUntil ?? null,
        newPublicToken(),
        data.notes ?? null,
        userId,
      ]
    );
    const quoteId = result.insertId;

    await insertLines(connection, quoteId, data.lines ?? []);

    await connection.commit();
    return getQuote(quoteId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function insertLines(connection, quoteId, lines) {
  let sortOrder = 0;
  for (const line of lines) {
    await connection.query(
      `INSERT INTO quote_lines
         (quote_id, product_variant_id, description, quantity, unit_price, discount_percent, tax_rate_percent, print_method_id, print_description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteId,
        line.productVariantId ?? line.product_variant_id ?? null,
        line.description ?? null,
        line.quantity,
        line.unitPrice ?? line.unit_price,
        line.discountPercent ?? line.discount_percent ?? 0,
        line.taxRatePercent ?? line.tax_rate_percent ?? null,
        line.printMethodId ?? line.print_method_id ?? null,
        line.printDescription ?? line.print_description ?? null,
        sortOrder++,
      ]
    );
  }
}

// Full-replace update: only meaningful while the quote is still a DRAFT
// (enforced by the route layer) — simpler and safer than diffing lines.
export async function updateQuote(id, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const fields = {
      customer_id: data.customerId,
      reference_contact_id: data.referenceContactId,
      valid_until: data.validUntil,
      notes: data.notes,
    };
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const setClause = entries.map(([col]) => `${col} = ?`).join(", ");
      await connection.query(`UPDATE quotes SET ${setClause} WHERE id = ?`, [
        ...entries.map(([, v]) => v),
        id,
      ]);
    }

    if (Array.isArray(data.lines)) {
      assertValidLines(data.lines);
      await connection.query(`DELETE FROM quote_lines WHERE quote_id = ?`, [id]);
      await insertLines(connection, id, data.lines);
    }

    await connection.commit();
    return getQuote(id);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function recordEvent(quoteId, type, meta = null) {
  await pool.query(`INSERT INTO quote_events (quote_id, type, meta) VALUES (?, ?, ?)`, [quoteId, type, meta]);
}

export async function sendQuote(id) {
  await pool.query(`UPDATE quotes SET status = 'SENT', sent_at = NOW() WHERE id = ? AND status = 'DRAFT'`, [id]);
  await recordEvent(id, "SENT");
  return getQuote(id);
}

// "Maila offert till kund" — actually emails the public quote link
// (rather than just marking the quote SENT and leaving staff to send it
// themselves some other way). Marks it SENT first if it's still a DRAFT,
// same as the plain "Skicka offert" action, then best-effort sends the
// email via integrations/email.js (a stub until SMTP is configured — see
// that file). publicUrl is built by the route handler (needs req.protocol
// /req.get("host"), not available down here).
export async function emailQuoteToCustomer(id, publicUrl) {
  let quote = await getQuote(id);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (!quote.customer_email) throw new Error("NO_CUSTOMER_EMAIL");

  if (quote.status === "DRAFT") {
    quote = await sendQuote(id);
  }

  const settings = await getSettings();
  const result = await sendQuoteEmail({
    to: quote.customer_email,
    customerName: quote.reference_name || quote.customer_name,
    quoteNumber: quote.quote_number,
    publicUrl,
    totalIncVat: quote.totals.total_inc_vat,
    validUntil: quote.valid_until,
    sellerName: settings?.seller_name,
    sellerLogoUrl: settings?.seller_logo_path ? `${new URL(publicUrl).origin}/uploads/${settings.seller_logo_path}` : null,
    brandColor: settings?.brand_color,
  });

  const reason = result.note ?? result.reason;
  await recordEvent(id, result.ok ? "EMAILED" : "EMAIL_FAILED", result.ok ? null : reason);
  return { ...(await getQuote(id)), notification: { sent: result.ok, reason } };
}

export async function markViewed(quoteId) {
  await pool.query(
    `UPDATE quotes SET status = 'VIEWED', viewed_at = NOW() WHERE id = ? AND status = 'SENT'`,
    [quoteId]
  );
  await recordEvent(quoteId, "VIEWED");
}

// ---------------------------------------------------------------------
// Påminnelser (Fas 7) — no SMTP is wired up, so "reminders" surface as a
// staff-visible list instead of an actual email. A quote needs one once
// it's sat unanswered (SENT/VIEWED) for reminder_days_after days and no
// REMINDER_SENT event has been logged for it yet; staff can mark it
// handled (recordEvent) once they've followed up by phone/e-mail.
// ---------------------------------------------------------------------

export async function listQuotesNeedingReminder(reminderDaysAfter) {
  const [rows] = await pool.query(
    `SELECT q.id, q.quote_number, q.status, q.sent_at, c.id AS customer_id, c.name AS customer_name
     FROM quotes q
     JOIN customers c ON c.id = q.customer_id
     WHERE q.status IN ('SENT', 'VIEWED')
       AND q.sent_at IS NOT NULL
       AND q.sent_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND NOT EXISTS (
         SELECT 1 FROM quote_events qe WHERE qe.quote_id = q.id AND qe.type = 'REMINDER_SENT'
       )
     ORDER BY q.sent_at ASC`,
    [reminderDaysAfter]
  );
  return rows;
}

export async function markReminderSent(quoteId) {
  const [[quote]] = await pool.query(`SELECT id FROM quotes WHERE id = ?`, [quoteId]);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  await recordEvent(quoteId, "REMINDER_SENT");
}

export async function respondToQuote(token, decision, meta) {
  const quote = await getQuoteByToken(token);
  if (!quote) return null;
  if (!["SENT", "VIEWED"].includes(quote.status)) return quote;

  const status = decision === "accept" ? "ACCEPTED" : "DECLINED";
  await pool.query(`UPDATE quotes SET status = ?, responded_at = NOW() WHERE id = ?`, [status, quote.id]);
  await recordEvent(quote.id, status, meta ?? null);
  return getQuote(quote.id);
}
