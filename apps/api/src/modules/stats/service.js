import { pool } from "../../lib/db.js";

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

function defaultRange({ from, to }) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

// One source of "sold lines": orders (order_lines/orders). Cancelled
// orders are excluded so this only reflects real revenue. (There used to
// be a second channel here, POS/kassa sale_lines/sales — removed along
// with the rest of that feature; see schema.sql.)
//
// product_variant_id can be NULL here (fritextrad — a free-text line with
// no catalog product behind it). Every query below LEFT JOINs product_variants/
// products (not JOIN) so those lines still count toward revenue/customer/
// category totals — same "unknown, not zero" treatment already used for
// cost_price IS NULL (margin excluded, lines_missing_cost counted). Only
// getTopProducts stays an inner join: a line with no product can't be a
// "top product" by definition.
const SALE_SOURCE_CTE = `
  WITH sale_source AS (
    SELECT ol.product_variant_id, ol.quantity, ol.unit_price, ol.discount_percent,
           o.created_at, o.customer_id
    FROM order_lines ol JOIN orders o ON o.id = ol.order_id
    WHERE o.status <> 'CANCELLED' AND o.created_at >= ? AND o.created_at < ? + INTERVAL 1 DAY
  )
`;

function rangeParams(range) {
  return [range.from, range.to];
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
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id`,
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

// Daglig försäljning senaste N dagarna, för diagrammet högst upp på
// Översikt. Fyller i dagar utan försäljning med 0 istället för att bara
// hoppa över dem, så serien blir sammanhängande (en lucka i grafen ska
// betyda "ingen försäljning", inte "data saknas").
export async function getDailySalesTrend(days = 90) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  const toStr = to.toISOString().slice(0, 10);
  const fromStr = from.toISOString().slice(0, 10);

  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT DATE_FORMAT(ss.created_at, '%Y-%m-%d') AS day,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat
     FROM sale_source ss
     GROUP BY day`,
    [fromStr, toStr]
  );
  const byDay = new Map(rows.map((r) => [r.day, round2(Number(r.revenue_ex_vat))]));

  const points = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 10);
    points.push({ date: key, revenue_ex_vat: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return { from: fromStr, to: toStr, points };
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
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
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

// Säsongstrend: samma sale_source som allt annat på statistiksidan, men
// grupperat per månad OCH kategori istället för en enda periodsumma — ger
// en första bild av när på året olika produktgrupper säljer, som underlag
// för att lägga inköp i tid inför en säsong. Ett enkelt v1 (se PLAN.md-
// diskussionen): ingen jämförelse mot föregående år än, bara de senaste N
// månaderna i rad.
export async function getMonthlyCategoryTrend(months = 12) {
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - (months - 1));
  fromDate.setDate(1);
  const from = fromDate.toISOString().slice(0, 10);

  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT DATE_FORMAT(ss.created_at, '%Y-%m') AS month,
            COALESCE(pc.id, 0) AS category_id, COALESCE(pc.name, 'Okategoriserad') AS category_name,
            SUM(ss.quantity) AS total_qty,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     GROUP BY month, COALESCE(pc.id, 0), COALESCE(pc.name, 'Okategoriserad')
     ORDER BY month ASC`,
    [from, to]
  );

  return {
    from,
    to,
    rows: rows.map((r) => ({
      ...r,
      total_qty: Number(r.total_qty),
      revenue_ex_vat: round2(Number(r.revenue_ex_vat)),
    })),
  };
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
     SELECT c.id AS customer_id, c.name,
            SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100)) AS revenue_ex_vat,
            CASE WHEN MAX(p.cost_price IS NULL) = 0
                 THEN SUM(ss.quantity * ss.unit_price * (1 - ss.discount_percent / 100) - ss.quantity * p.cost_price)
                 ELSE NULL END AS margin_amount
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     JOIN customers c ON c.id = ss.customer_id
     GROUP BY c.id, c.name
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
