import crypto from "node:crypto";
import { pool } from "../../lib/db.js";
import { assertValidLines } from "../../lib/lines.js";
import { getSettings } from "../settings/service.js";
import { sendQuoteEmail, sendQuoteReminderEmail } from "../integrations/email.js";
import { ASSORTMENT_DISCOUNT_SELECT } from "../customers/service.js";

// Sekventiella offertnummer (OFF-0001, OFF-0002, ...) istället för
// slumpmässiga tidsstämplar — samma mönster som nextOrderNumber i
// orders/service.js: läses/räknas upp inom SAMMA transaktion som offerten
// skapas i, så UPDATE-radlåset på app_settings förhindrar dubbletter.
async function nextQuoteNumber(connection) {
  await connection.query(`UPDATE app_settings SET next_quote_number = next_quote_number + 1 WHERE id = 1`);
  const [[{ next_quote_number }]] = await connection.query(
    `SELECT next_quote_number FROM app_settings WHERE id = 1`
  );
  return `OFF-${String(next_quote_number - 1).padStart(4, "0")}`;
}

function newPublicToken() {
  return crypto.randomBytes(24).toString("hex");
}

// Offerter är giltiga 10 dagar som standard om inget annat anges — säljaren
// kan alltid ändra datumet innan den skickas.
const DEFAULT_VALID_DAYS = 10;
function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + DEFAULT_VALID_DAYS);
  return d.toISOString().slice(0, 10);
}

// unit_price * quantity * (1 - discount%), plus the same for tryck (if
// print_price is set — tryck is optional per line, quantity always
// follows the line's own quantity, no separate tryckantal) — always ex
// moms, per PLAN.md.
function lineTotal(line) {
  const productTotal = Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
  const printTotal =
    line.print_price === null || line.print_price === undefined
      ? 0
      : Number(line.quantity) * Number(line.print_price) * (1 - Number(line.print_discount_percent ?? 0) / 100);
  return productTotal + printTotal;
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
            COALESCE(SUM(
              ql.quantity * ql.unit_price * (1 - ql.discount_percent / 100)
              + IFNULL(ql.quantity * ql.print_price * (1 - ql.print_discount_percent / 100), 0)
            ), 0) AS total_amount
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
            p.cost_price, p.image_url, v.sku, v.color, v.size, v.barcode
     FROM quote_lines ql
     LEFT JOIN product_variants v ON v.id = ql.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
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

    const quoteNumber = await nextQuoteNumber(connection);
    const [result] = await connection.query(
      `INSERT INTO quotes (quote_number, customer_id, reference_contact_id, valid_until, public_token, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteNumber,
        data.customerId,
        data.referenceContactId ?? null,
        data.validUntil ?? defaultValidUntil(),
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
         (quote_id, product_variant_id, description, quantity, unit_price, discount_percent, tax_rate_percent, print_description, print_price, print_discount_percent, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteId,
        line.productVariantId ?? line.product_variant_id ?? null,
        line.description ?? null,
        line.quantity,
        line.unitPrice ?? line.unit_price,
        line.discountPercent ?? line.discount_percent ?? 0,
        line.taxRatePercent ?? line.tax_rate_percent ?? null,
        line.printDescription ?? line.print_description ?? null,
        line.printPrice ?? line.print_price ?? null,
        line.printDiscountPercent ?? line.print_discount_percent ?? 0,
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

// "Duplicera" — a fresh DRAFT with the same customer/referens/rader/
// anteckningar, new quote_number and public_token, nothing else carried
// over (status, sent_at, valid_until, events all start clean). Reuses
// createQuote, which already accepts quote.lines' snake_case DB shape
// directly (see insertLines above).
export async function duplicateQuote(id, userId) {
  const quote = await getQuote(id);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");

  return createQuote(
    {
      customerId: quote.customer_id,
      referenceContactId: quote.reference_contact_id,
      notes: quote.notes,
      lines: quote.lines,
    },
    userId
  );
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
  let result;
  try {
    result = await sendQuoteEmail({
      settings,
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
  } catch (err) {
    result = { ok: false, reason: err.message };
  }

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
// Påminnelser (Fas 7): en offert som sitt obesvarad (SENT/VIEWED) i
// reminder_days_after dagar utan ett loggat REMINDER_SENT-event dyker
// upp i den här listan (se dashboard.js) med en "Skicka påminnelse"-
// knapp, se sendQuoteReminder nedan.
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

// Skickar en riktig påminnelse till kunden (samma e-postmotor som "Maila
// offert till kund") istället för att bara sätta en intern flagga.
// REMINDER_SENT är vad listQuotesNeedingReminder ovan letar efter för att
// plocka bort en offert den redan påmint om — en lyckad påminnelse gör
// alltså att offerten försvinner ur listan av sig själv. Ett misslyckat
// försök (t.ex. e-post inte konfigurerat än) loggas som REMINDER_FAILED
// istället och lämnar offerten kvar i listan så den går att försöka igen.
export async function sendQuoteReminder(id, publicUrl) {
  const quote = await getQuote(id);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (!quote.customer_email) throw new Error("NO_CUSTOMER_EMAIL");

  const settings = await getSettings();
  let result;
  try {
    result = await sendQuoteReminderEmail({
      settings,
      to: quote.customer_email,
      customerName: quote.reference_name || quote.customer_name,
      quoteNumber: quote.quote_number,
      publicUrl,
      totalIncVat: quote.totals.total_inc_vat,
      sellerName: settings?.seller_name,
      sellerLogoUrl: settings?.seller_logo_path ? `${new URL(publicUrl).origin}/uploads/${settings.seller_logo_path}` : null,
      brandColor: settings?.brand_color,
    });
  } catch (err) {
    result = { ok: false, reason: err.message };
  }

  const reason = result.note ?? result.reason;
  await recordEvent(id, result.ok ? "REMINDER_SENT" : "REMINDER_FAILED", result.ok ? null : reason);
  return { sent: result.ok, reason };
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

// "Andra kunder gillade också" — visas på den publika offertsidan. Räknar
// fram vilka produkter som oftast dyker upp i SAMMA riktiga order som
// produkterna redan i den här offerten (co-occurrence i order_lines — en
// faktisk beställning är ett starkare signal än andra öppna offerter).
// Medvetet INGEN koppling till kundens eget kurerade sortiment
// (customer_assortment) här, till skillnad från portalbeställningen —
// hela poängen med den här listan är att visa kunden något den inte redan
// har valt ut, inte begränsa till det den redan ser.
export async function getSuggestedProducts(quoteId, limit = 3) {
  const [ownProducts] = await pool.query(
    `SELECT DISTINCT v.product_id
     FROM quote_lines ql
     JOIN product_variants v ON v.id = ql.product_variant_id
     WHERE ql.quote_id = ?`,
    [quoteId]
  );
  const productIds = ownProducts.map((r) => r.product_id);
  if (productIds.length === 0) return [];

  const [[{ customer_id: customerId }]] = await pool.query(`SELECT customer_id FROM quotes WHERE id = ?`, [quoteId]);

  const ownPlaceholders = productIds.map(() => "?").join(",");
  const [suggestions] = await pool.query(
    `SELECT p.id AS product_id, p.name, p.image_url, p.base_price, p.tax_rate_percent,
            COUNT(*) AS score,
            ${ASSORTMENT_DISCOUNT_SELECT}
     FROM order_lines ol1
     JOIN product_variants v1 ON v1.id = ol1.product_variant_id AND v1.product_id IN (${ownPlaceholders})
     JOIN order_lines ol2 ON ol2.order_id = ol1.order_id AND ol2.id <> ol1.id
     JOIN product_variants v2 ON v2.id = ol2.product_variant_id
     JOIN products p ON p.id = v2.product_id AND p.active = 1 AND p.id NOT IN (${ownPlaceholders})
     GROUP BY p.id, p.name, p.image_url, p.base_price, p.tax_rate_percent
     ORDER BY score DESC
     LIMIT ?`,
    [customerId, customerId, ...productIds, ...productIds, limit]
  );
  if (suggestions.length === 0) return [];

  const suggestedIds = suggestions.map((s) => s.product_id);
  const idPlaceholders = suggestedIds.map(() => "?").join(",");
  const [variants] = await pool.query(
    `SELECT id, product_id, color, size, price_override
     FROM product_variants WHERE product_id IN (${idPlaceholders}) AND active = 1
     ORDER BY color ASC, size ASC`,
    suggestedIds
  );

  return suggestions.map((s) => ({
    product_id: s.product_id,
    name: s.name,
    image_url: s.image_url,
    tax_rate_percent: s.tax_rate_percent,
    discount_percent: Number(s.discount_percent) || 0,
    variants: variants
      .filter((v) => v.product_id === s.product_id)
      .map((v) => ({
        id: v.id,
        color: v.color,
        size: v.size,
        price: round2(Number(v.price_override ?? s.base_price) * (1 - (Number(s.discount_percent) || 0) / 100)),
      })),
  }));
}

// Lägger till en föreslagen produkt i offerten direkt från den publika
// sidan (ingen inloggning — samma tillitsmodell som accept/decline, se
// public.js). Pris/rabatt räknas alltid fram server-side här, precis som
// portalbeställningen — klienten skickar bara vilken variant och hur
// många, aldrig ett pris. Tillåtet medan offerten fortfarande väntar på
// svar (SENT/VIEWED); en redan accepterad/avböjd/konverterad offert är
// stängd för ändringar, precis som för accept/decline själva.
export async function addSuggestedLineToQuote(token, { productVariantId, quantity }) {
  const quote = await getQuoteByToken(token);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (!["SENT", "VIEWED"].includes(quote.status)) throw new Error("QUOTE_NOT_OPEN");

  const qty = Number(quantity);
  if (!(qty > 0) || !productVariantId) throw new Error("INVALID_LINE");

  const [[priced]] = await pool.query(
    `SELECT v.id AS variant_id, v.color, v.size, v.price_override,
            p.name, p.base_price, p.tax_rate_percent,
            ${ASSORTMENT_DISCOUNT_SELECT}
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     WHERE v.id = ? AND v.active = 1 AND p.active = 1`,
    [quote.customer_id, quote.customer_id, productVariantId]
  );
  if (!priced) throw new Error("INVALID_LINE");

  // Samma variant redan på offerten -> bumpa bara antalet (som vid
  // omscanning i order-editor) istället för en duplicerad rad.
  const existing = quote.lines.find((l) => l.product_variant_id === priced.variant_id);
  if (existing) {
    await pool.query(`UPDATE quote_lines SET quantity = quantity + ? WHERE id = ?`, [qty, existing.id]);
  } else {
    const [[{ maxSort }]] = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) AS maxSort FROM quote_lines WHERE quote_id = ?`,
      [quote.id]
    );
    await pool.query(
      `INSERT INTO quote_lines (quote_id, product_variant_id, quantity, unit_price, discount_percent, tax_rate_percent, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        quote.id,
        priced.variant_id,
        qty,
        Number(priced.price_override ?? priced.base_price),
        Number(priced.discount_percent) || 0,
        Number(priced.tax_rate_percent),
        maxSort + 1,
      ]
    );
  }

  const variantLabel = [priced.color, priced.size].filter(Boolean).join(" / ");
  await recordEvent(quote.id, "LINE_ADDED_BY_CUSTOMER", `${qty} × ${priced.name}${variantLabel ? ` (${variantLabel})` : ""}`);

  return getQuoteByToken(token);
}
