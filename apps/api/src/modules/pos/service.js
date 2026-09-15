import { pool } from "../../lib/db.js";
import { createCustomerInvoice, createCashInvoice } from "../integrations/fortnox.js";
import { recordMovement, DEFAULT_WAREHOUSE_ID } from "../inventory/service.js";
import { assertValidLines } from "../../lib/lines.js";

function nextSaleNumber() {
  return `KV-${Math.floor(Date.now() / 1000)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function lineTotal(line) {
  return Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
}

// null when the product has no cost_price set — margin for that line is
// simply unknown, not zero.
function lineMargin(line, total) {
  if (line.cost_price === null || line.cost_price === undefined) return null;
  return total - Number(line.quantity) * Number(line.cost_price);
}

function summarizeTotals(lines) {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.tax_rate_percent) / 100), 0);
  const margins = lines.map((l) => lineMargin(l, lineTotal(l))).filter((m) => m !== null);
  const marginAmount = margins.reduce((sum, m) => sum + m, 0);

  return {
    subtotal_ex_vat: round2(subtotal),
    vat_amount: round2(vat),
    total_inc_vat: round2(subtotal + vat),
    margin_amount: round2(marginAmount),
    margin_percent: subtotal > 0 ? round2((marginAmount / subtotal) * 100) : 0,
    margin_incomplete: margins.length < lines.length,
  };
}

// --- Kassasessioner --------------------------------------------------------

export async function getOpenSession() {
  const [[session]] = await pool.query(
    `SELECT ps.*, u.name AS opened_by_name FROM pos_sessions ps
     LEFT JOIN users u ON u.id = ps.opened_by
     WHERE ps.closed_at IS NULL ORDER BY ps.opened_at DESC LIMIT 1`
  );
  return session ?? null;
}

// Idempotent: returns the already-open session instead of erroring, so a
// stray double-click on "Öppna kassa" can't create two sessions.
export async function openSession({ name, openingFloat }, userId) {
  const existing = await getOpenSession();
  if (existing) return existing;

  await pool.query(`INSERT INTO pos_sessions (name, opened_by, opening_float) VALUES (?, ?, ?)`, [
    name || "Kassa",
    userId,
    openingFloat ?? 0,
  ]);
  return getOpenSession();
}

export async function closeSession(id, { closingFloat }) {
  const [[session]] = await pool.query(`SELECT * FROM pos_sessions WHERE id = ?`, [id]);
  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (session.closed_at) throw new Error("SESSION_ALREADY_CLOSED");

  const [byMethod] = await pool.query(
    `SELECT p.method, SUM(p.amount) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.session_id = ? GROUP BY p.method`,
    [id]
  );

  const totalsByMethod = Object.fromEntries(byMethod.map((r) => [r.method, Number(r.total)]));
  const cashTotal = totalsByMethod.CASH ?? 0;
  const expectedCash = round2(Number(session.opening_float) + cashTotal);
  const diff = round2(Number(closingFloat) - expectedCash);

  await pool.query(`UPDATE pos_sessions SET closed_at = NOW(), closing_float = ? WHERE id = ?`, [
    closingFloat,
    id,
  ]);

  return {
    session: { ...session, closed_at: new Date(), closing_float: closingFloat },
    totalsByMethod,
    expectedCash,
    diff,
  };
}

// --- Försäljning -----------------------------------------------------------

async function loadSaleLines(saleId) {
  // LEFT JOIN: a fritextrad (free-text line) has no product_variant_id, so
  // p/v come back all-NULL for it — COALESCE falls back to the line's own
  // description/tax_rate_percent in that case.
  const [lines] = await pool.query(
    `SELECT sl.*, COALESCE(p.name, sl.description) AS product_name,
            COALESCE(p.tax_rate_percent, sl.tax_rate_percent) AS tax_rate_percent,
            p.cost_price, v.sku, v.color, v.size
     FROM sale_lines sl
     LEFT JOIN product_variants v ON v.id = sl.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE sl.sale_id = ?
     ORDER BY sl.id ASC`,
    [saleId]
  );
  return lines.map((line) => {
    const total = lineTotal(line);
    return { ...line, line_total: total, line_margin: lineMargin(line, total) };
  });
}

export async function getSale(id) {
  const [[sale]] = await pool.query(
    `SELECT s.*, c.name AS customer_name, u.name AS cashier_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     JOIN users u ON u.id = s.cashier_id
     WHERE s.id = ?`,
    [id]
  );
  if (!sale) return null;

  const lines = await loadSaleLines(id);
  const [payments] = await pool.query(`SELECT * FROM payments WHERE sale_id = ? ORDER BY id ASC`, [id]);
  const [invoices] = await pool.query(
    `SELECT id, type, status, status_note, external_ref, invoice_number, amount, created_at
     FROM invoices WHERE sale_id = ? ORDER BY id ASC`,
    [id]
  );

  return { ...sale, lines, payments, invoices, totals: summarizeTotals(lines) };
}

export async function listSales({ sessionId, page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const where = sessionId ? "WHERE s.session_id = ?" : "";
  const params = sessionId ? [sessionId, pageSize, offset] : [pageSize, offset];

  const [rows] = await pool.query(
    `SELECT s.id, s.sale_number, s.status, s.created_at, c.name AS customer_name,
            COALESCE(SUM(sl.quantity * sl.unit_price * (1 - sl.discount_percent / 100)), 0) AS subtotal_ex_vat
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN sale_lines sl ON sl.sale_id = s.id
     ${where}
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  return { rows };
}

export async function createSale(data, userId) {
  if (!data.sessionId || !Array.isArray(data.lines) || data.lines.length === 0) {
    throw new Error("INVALID_SALE");
  }
  assertValidLines(data.lines);
  if (!Array.isArray(data.payments) || data.payments.length === 0) {
    throw new Error("PAYMENT_REQUIRED");
  }
  if (data.payments.some((p) => p.method === "INVOICE") && !data.customerId) {
    // A Fortnox customer invoice needs a customer to invoice.
    throw new Error("INVOICE_REQUIRES_CUSTOMER");
  }

  // A fritextrad (free-text line) has no productVariantId — its own
  // taxRatePercent (set by the cashier) is used as-is below instead.
  const variantIds = data.lines.map((l) => l.productVariantId).filter(Boolean);
  const taxByVariant = new Map();
  if (variantIds.length > 0) {
    const [taxRows] = await pool.query(
      `SELECT v.id AS variant_id, p.tax_rate_percent
       FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id IN (?)`,
      [variantIds]
    );
    for (const row of taxRows) taxByVariant.set(row.variant_id, Number(row.tax_rate_percent));
  }

  const linesWithTax = data.lines.map((l) => ({
    quantity: l.quantity,
    unit_price: l.unitPrice,
    discount_percent: l.discountPercent ?? 0,
    tax_rate_percent: l.productVariantId ? taxByVariant.get(l.productVariantId) ?? 25 : l.taxRatePercent ?? 25,
  }));
  const totals = summarizeTotals(linesWithTax);

  const paymentSum = round2(data.payments.reduce((sum, p) => sum + Number(p.amount), 0));
  if (Math.abs(paymentSum - totals.total_inc_vat) > 0.01) {
    const err = new Error("AMOUNT_MISMATCH");
    err.expected = totals.total_inc_vat;
    err.received = paymentSum;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO sales (sale_number, session_id, customer_id, cashier_id) VALUES (?, ?, ?, ?)`,
      [nextSaleNumber(), data.sessionId, data.customerId ?? null, userId]
    );
    const saleId = result.insertId;

    for (const line of data.lines) {
      await connection.query(
        `INSERT INTO sale_lines (sale_id, product_variant_id, description, quantity, unit_price, discount_percent, tax_rate_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          line.productVariantId ?? null,
          line.description ?? null,
          line.quantity,
          line.unitPrice,
          line.discountPercent ?? 0,
          line.productVariantId ? null : line.taxRatePercent ?? 25,
        ]
      );
      // A fritextrad (free-text line) has no product to deduct stock for.
      if (!line.productVariantId) continue;
      await recordMovement(connection, {
        variantId: line.productVariantId,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        type: "SALE_OUT",
        quantityDelta: -Number(line.quantity),
        referenceType: "sale",
        referenceId: saleId,
        userId,
      });
    }

    const invoicesToSync = [];
    for (const payment of data.payments) {
      await connection.query(`INSERT INTO payments (sale_id, method, amount, reference) VALUES (?, ?, ?, ?)`, [
        saleId,
        payment.method,
        payment.amount,
        payment.reference ?? null,
      ]);

      // Faktura -> kundfaktura i Fortnox (kräver en vald kund, validerat
      // ovan). Swish -> kontantfaktura i Fortnox. Both just get a PENDING
      // invoices row here; the actual Fortnox call happens after commit
      // (see below) so a slow/unavailable Fortnox never blocks the sale.
      if (payment.method === "INVOICE" || payment.method === "SWISH") {
        const [invoiceResult] = await connection.query(
          `INSERT INTO invoices (order_id, sale_id, type, amount, status)
           VALUES (NULL, ?, ?, ?, 'PENDING')`,
          [saleId, payment.method === "INVOICE" ? "CUSTOMER_INVOICE" : "CASH_INVOICE", payment.amount]
        );
        invoicesToSync.push({
          id: invoiceResult.insertId,
          type: payment.method === "INVOICE" ? "CUSTOMER_INVOICE" : "CASH_INVOICE",
          amount: payment.amount,
        });
      }
    }

    await connection.commit();

    // Best-effort: Fortnox isn't configured yet (see fortnox.js), so this
    // just marks each invoice PENDING-with-a-note today. Never lets a
    // Fortnox failure undo an already-completed sale.
    for (const invoice of invoicesToSync) {
      try {
        const result =
          invoice.type === "CUSTOMER_INVOICE"
            ? await createCustomerInvoice({ customerId: data.customerId, amount: invoice.amount, saleId })
            : await createCashInvoice({ amount: invoice.amount, saleId });

        if (result.ok) {
          await pool.query(`UPDATE invoices SET status = 'SYNCED', external_ref = ?, invoice_number = ? WHERE id = ?`, [
            result.externalRef ?? null,
            result.invoiceNumber ?? null,
            invoice.id,
          ]);
        } else {
          await pool.query(`UPDATE invoices SET status_note = ? WHERE id = ?`, [result.note ?? result.reason, invoice.id]);
        }
      } catch (err) {
        await pool.query(`UPDATE invoices SET status = 'FAILED', status_note = ? WHERE id = ?`, [
          err.message,
          invoice.id,
        ]);
      }
    }

    return getSale(saleId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
