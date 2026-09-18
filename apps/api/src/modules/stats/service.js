import { pool } from "../../lib/db.js";

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

function defaultRange({ from, to }) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

// One combined source of "sold lines" across both sales channels: POS
// (sale_lines/sales) and orders (order_lines/orders). Cancelled orders and
// non-completed sales are excluded so this only reflects real revenue.
const SALE_SOURCE_CTE = `
  WITH sale_source AS (
    SELECT sl.product_variant_id, sl.quantity, sl.unit_price, sl.discount_percent,
           s.created_at, s.customer_id
    FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
    WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ? + INTERVAL 1 DAY
    UNION ALL
    SELECT ol.product_variant_id, ol.quantity, ol.unit_price, ol.discount_percent,
           o.created_at, o.customer_id
    FROM order_lines ol JOIN orders o ON o.id = ol.order_id
    WHERE o.status <> 'CANCELLED' AND o.created_at >= ? AND o.created_at < ? + INTERVAL 1 DAY
  )
`;

function rangeParams(range) {
  return [range.from, range.to, range.from, range.to];
}

export async function getSummary(rangeInput) {
  const range = defaultRange(rangeInput);
  const [[row]] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT
       COALESCE(SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)), 0) AS revenue_ex_vat,
       SUM(CASE WHEN p.cost_price IS NOT NULL
                THEN ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100) - ss.quantity * p.cost_price
                ELSE 0 END) AS margin_amount,
       SUM(CASE WHEN p.cost_price IS NULL THEN 1 ELSE 0 END) AS lines_missing_cost,
       COUNT(*) AS line_count
     FROM sale_source ss
     JOIN product_variants v ON v.id = ss.product_variant_id
     JOIN products p ON p.id = v.product_id`,
    rangeParams(range)
  );

  const revenue = Number(row.revenue_ex_vat);
  const margin = Number(row.margin_amount);
  return {
    range,
    revenue_ex_vat: round2(revenue),
    margin_amount: round2(margin),
    margin_percent: revenue > 0 ? round2((margin / revenue) * 100) : 0,
    margin_incomplete: Number(row.lines_missing_cost) > 0,
  };
}

export async function getTopProducts(rangeInput, limit = 20) {
  const range = defaultRange(rangeInput);
  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT p.id AS product_id, p.name,
            SUM(ss.quantity) AS total_qty,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat,
            CASE WHEN MAX(p.cost_price IS NULL) = 0
                 THEN SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100) - ss.quantity * p.cost_price)
                 ELSE NULL END AS margin_amount
     FROM sale_source ss
     JOIN product_variants v ON v.id = ss.product_variant_id
     JOIN products p ON p.id = v.product_id
     GROUP BY p.id, p.name
     ORDER BY revenue_ex_vat DESC
     LIMIT ?`,
    [...rangeParams(range), limit]
  );
  return rows.map((r) => ({
    ...r,
    total_qty: Number(r.total_qty),
    revenue_ex_vat: round2(Number(r.revenue_ex_vat)),
    margin_amount: r.margin_amount === null ? null : round2(Number(r.margin_amount)),
  }));
}

export async function getTopCategories(rangeInput, limit = 20) {
  const range = defaultRange(rangeInput);
  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT COALESCE(pc.id, 0) AS category_id, COALESCE(pc.name, 'Okategoriserad') AS name,
            SUM(ss.quantity) AS total_qty,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat,
            CASE WHEN MAX(p.cost_price IS NULL) = 0
                 THEN SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100) - ss.quantity * p.cost_price)
                 ELSE NULL END AS margin_amount
     FROM sale_source ss
     JOIN product_variants v ON v.id = ss.product_variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     GROUP BY COALESCE(pc.id, 0), COALESCE(pc.name, 'Okategoriserad')
     ORDER BY revenue_ex_vat DESC
     LIMIT ?`,
    [...rangeParams(range), limit]
  );
  return rows.map((r) => ({
    ...r,
    total_qty: Number(r.total_qty),
    revenue_ex_vat: round2(Number(r.revenue_ex_vat)),
    margin_amount: r.margin_amount === null ? null : round2(Number(r.margin_amount)),
  }));
}

// Öppen offertpipeline: värdet av allt som just nu väntar på kundsvar.
// DRAFT räknas inte in (inte ens skickad än) — bara SENT/VIEWED, precis som
// "canRespond" på den publika offertsidan. Till skillnad från resten av
// statistiksidan har det här ingen datumperiod: det är ett ögonblicksläge
// av vad som är på gång just nu, inte historik.
const OPEN_QUOTE_STATUSES = ["SENT", "VIEWED"];

export async function getOpenQuotePipeline() {
  const [rows] = await pool.query(
    `SELECT q.id, q.quote_number, q.status, q.sent_at, c.name AS customer_name,
            COALESCE(SUM(ql.quantity * ql.unit_price * (1 - ql.discount_percent / 100)), 0) AS total_value
     FROM quotes q
     JOIN customers c ON c.id = q.customer_id
     LEFT JOIN quote_lines ql ON ql.quote_id = q.id
     WHERE q.status IN (?)
     GROUP BY q.id, q.quote_number, q.status, q.sent_at, c.name
     ORDER BY q.sent_at ASC`,
    [OPEN_QUOTE_STATUSES]
  );

  const quotes = rows.map((r) => ({
    id: r.id,
    quote_number: r.quote_number,
    status: r.status,
    customer_name: r.customer_name,
    total_value: round2(Number(r.total_value)),
    days_open: r.sent_at ? Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86400000) : 0,
  }));

  const totalValue = quotes.reduce((sum, q) => sum + q.total_value, 0);
  const byStatus = new Map();
  for (const q of quotes) {
    const entry = byStatus.get(q.status) ?? { status: q.status, quote_count: 0, total_value: 0 };
    entry.quote_count += 1;
    entry.total_value += q.total_value;
    byStatus.set(q.status, entry);
  }

  return {
    quote_count: quotes.length,
    total_value: round2(totalValue),
    average_value: quotes.length > 0 ? round2(totalValue / quotes.length) : 0,
    oldest_days_open: quotes.length > 0 ? Math.max(...quotes.map((q) => q.days_open)) : 0,
    by_status: [...byStatus.values()].map((e) => ({ ...e, total_value: round2(e.total_value) })),
    quotes: quotes.sort((a, b) => b.total_value - a.total_value),
  };
}

export async function getTopCustomers(rangeInput, limit = 20) {
  const range = defaultRange(rangeInput);
  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT COALESCE(c.id, 0) AS customer_id, COALESCE(c.name, 'Kassaköp utan vald kund') AS name,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat,
            CASE WHEN MAX(p.cost_price IS NULL) = 0
                 THEN SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100) - ss.quantity * p.cost_price)
                 ELSE NULL END AS margin_amount
     FROM sale_source ss
     JOIN product_variants v ON v.id = ss.product_variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN customers c ON c.id = ss.customer_id
     GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'Kassaköp utan vald kund')
     ORDER BY revenue_ex_vat DESC
     LIMIT ?`,
    [...rangeParams(range), limit]
  );
  return rows.map((r) => ({
    ...r,
    revenue_ex_vat: round2(Number(r.revenue_ex_vat)),
    margin_amount: r.margin_amount === null ? null : round2(Number(r.margin_amount)),
  }));
}
