import { pool } from "@proarb/db";

function nextSaleNumber() {
  return `KV-${Math.floor(Date.now() / 1000)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function lineTotal(line) {
  return Number(line.quantity) * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
}

function summarizeTotals(lines) {
  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const vat = lines.reduce((sum, l) => sum + lineTotal(l) * (Number(l.tax_rate_percent) / 100), 0);
  return { subtotal_ex_vat: round2(subtotal), vat_amount: round2(vat), total_inc_vat: round2(subtotal + vat) };
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
  const [lines] = await pool.query(
    `SELECT sl.*, p.name AS product_name, p.tax_rate_percent, v.sku, v.color, v.size
     FROM sale_lines sl
     JOIN product_variants v ON v.id = sl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE sl.sale_id = ?
     ORDER BY sl.id ASC`,
    [saleId]
  );
  return lines;
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

  return { ...sale, lines, payments, totals: summarizeTotals(lines) };
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
  if (!Array.isArray(data.payments) || data.payments.length === 0) {
    throw new Error("PAYMENT_REQUIRED");
  }

  const variantIds = data.lines.map((l) => l.productVariantId);
  const [taxRows] = await pool.query(
    `SELECT v.id AS variant_id, p.tax_rate_percent
     FROM product_variants v JOIN products p ON p.id = v.product_id
     WHERE v.id IN (?)`,
    [variantIds]
  );
  const taxByVariant = new Map(taxRows.map((r) => [r.variant_id, Number(r.tax_rate_percent)]));

  const linesWithTax = data.lines.map((l) => ({
    quantity: l.quantity,
    unit_price: l.unitPrice,
    discount_percent: l.discountPercent ?? 0,
    tax_rate_percent: taxByVariant.get(l.productVariantId) ?? 25,
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
        `INSERT INTO sale_lines (sale_id, product_variant_id, quantity, unit_price, discount_percent)
         VALUES (?, ?, ?, ?, ?)`,
        [saleId, line.productVariantId, line.quantity, line.unitPrice, line.discountPercent ?? 0]
      );
    }

    for (const payment of data.payments) {
      await connection.query(`INSERT INTO payments (sale_id, method, amount, reference) VALUES (?, ?, ?, ?)`, [
        saleId,
        payment.method,
        payment.amount,
        payment.reference ?? null,
      ]);
    }

    await connection.commit();
    return getSale(saleId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
