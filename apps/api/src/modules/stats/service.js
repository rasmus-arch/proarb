import { expireOverdueQuotes } from "../quotes/service.js";
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
// Varje orderrad ger en rad här, plus en EXTRA rad för tryck/brodyr när
// raden har ett tryckpris (is_print = 1). Trycket räknas alltså som en egen
// "produkt" (Tryck & brodyr) i omsättning, topplistor, kategorier och
// rabatter. Tryck har inget inköpspris och räknas inte med i marginalen.
//
// product_variant_id is NULL for fritextrader and for the tryck rows. Every
// query below LEFT JOINs product_variants/products so those still count
// toward revenue/customer/category totals.
//
// gross = före rabatt, revenue = efter rabatt — skillnaden är rabatten
// ("pengar vi ger bort"), se getDiscounts.
const SALE_SOURCE_CTE = `
  WITH sold_orders AS (
    SELECT o.id, o.created_at, o.customer_id,
           EXISTS (
             SELECT 1 FROM order_lines fx
             WHERE fx.order_id = o.id AND fx.product_variant_id IS NULL AND fx.cost_price IS NULL
           ) AS margin_excluded
    FROM orders o
    WHERE o.status <> 'CANCELLED' AND o.created_at >= ? AND o.created_at < ? + INTERVAL 1 DAY
  ),
  sale_source AS (
    SELECT ol.product_variant_id, ol.quantity, ol.unit_price, ol.discount_percent, ol.discount_amount, 0 AS is_print,
           o.id AS order_id, o.created_at, o.customer_id, o.margin_excluded,
           CASE WHEN ol.product_variant_id IS NULL THEN ol.cost_price ELSE sp.cost_price END AS cost_price
    FROM order_lines ol
    JOIN sold_orders o ON o.id = ol.order_id
    LEFT JOIN product_variants sv ON sv.id = ol.product_variant_id
    LEFT JOIN products sp ON sp.id = sv.product_id
    UNION ALL
    SELECT NULL, ol.quantity, ol.print_price, ol.print_discount_percent, 0, 1,
           o.id, o.created_at, o.customer_id, o.margin_excluded,
           NULL
    FROM order_lines ol
    JOIN sold_orders o ON o.id = ol.order_id
    WHERE ol.print_price IS NOT NULL AND ol.print_price <> 0
  )
`;

// Rader som räknas in i marginalen: inköpspris känt, inte tryck, OCH
// ordern har ingen fritextrad utan inköpspris (en sådan order utesluts
// helt — annars skulle fritextradens försäljning se ut som ren vinst eller
// dra ner procenten).
const MARGIN_LINE = "(ss.margin_excluded = 0 AND ss.is_print = 0 AND ss.cost_price IS NOT NULL)";
const LINE_GROSS = "ss.quantity * ss.unit_price";
// Rabatt i % och/eller kr/st (discount_amount), se lib/lines.js.
const LINE_REVENUE = "ss.quantity * (ss.unit_price * (1 - ss.discount_percent / 100) - ss.discount_amount)";
const LINE_DISCOUNT = "ss.quantity * (ss.unit_price * ss.discount_percent / 100 + ss.discount_amount)";
// Per grupp (produkt/kategori/kund): NULL när någon (icke-tryck-)rad saknar
// inköpspris eller inget i gruppen alls kan räknas.
const GROUP_MARGIN = `CASE WHEN MAX(ss.margin_excluded = 0 AND ss.is_print = 0 AND ss.cost_price IS NULL) = 1
                   OR MIN(ss.margin_excluded = 1 OR ss.is_print = 1) = 1
                 THEN NULL
                 ELSE SUM(CASE WHEN ${MARGIN_LINE} THEN ${LINE_REVENUE} - ss.quantity * ss.cost_price ELSE 0 END) END`;

const PRINT_NAME = "'Tryck & brodyr'";
const ITEM_NAME = `CASE WHEN ss.is_print = 1 THEN ${PRINT_NAME} WHEN ss.product_variant_id IS NULL THEN 'Fritextrader' ELSE p.name END`;
const CATEGORY_ID = "CASE WHEN ss.is_print = 1 THEN -1 ELSE COALESCE(pc.id, 0) END";
const CATEGORY_NAME = `CASE WHEN ss.is_print = 1 THEN ${PRINT_NAME} ELSE COALESCE(pc.name, 'Okategoriserad') END`;

function rangeParams(range) {
  return [range.from, range.to];
}

export async function getSummary(rangeInput) {
  const range = defaultRange(rangeInput);
  const [[row]] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT
       COALESCE(SUM(${LINE_REVENUE}), 0) AS revenue_ex_vat,
       COALESCE(SUM(${LINE_DISCOUNT}), 0) AS discount_amount,
       COALESCE(SUM(CASE WHEN ss.is_print = 1 THEN ${LINE_REVENUE} ELSE 0 END), 0) AS print_revenue,
       COALESCE(SUM(CASE WHEN ${MARGIN_LINE} THEN ${LINE_REVENUE} - ss.quantity * ss.cost_price ELSE 0 END), 0) AS margin_amount,
       COALESCE(SUM(CASE WHEN ${MARGIN_LINE} THEN ${LINE_REVENUE} ELSE 0 END), 0) AS margin_revenue,
       SUM(CASE WHEN ss.margin_excluded = 0 AND ss.is_print = 0 AND ss.cost_price IS NULL THEN 1 ELSE 0 END) AS lines_missing_cost,
       COUNT(DISTINCT CASE WHEN ss.margin_excluded = 1 THEN ss.order_id END) AS excluded_orders,
       COUNT(*) AS line_count
     FROM sale_source ss`,
    rangeParams(range)
  );

  const revenue = Number(row.revenue_ex_vat);
  const margin = Number(row.margin_amount);
  const marginRevenue = Number(row.margin_revenue);
  return {
    range,
    revenue_ex_vat: round2(revenue),
    margin_amount: round2(margin),
    // Procenten räknas bara på den försäljning som ingår i marginalen.
    margin_percent: marginRevenue > 0 ? round2((margin / marginRevenue) * 100) : 0,
    margin_incomplete: Number(row.lines_missing_cost) > 0 || Number(row.excluded_orders) > 0,
    lines_missing_cost: Number(row.lines_missing_cost),
    discount_amount: round2(Number(row.discount_amount)),
    print_revenue: round2(Number(row.print_revenue)),
    excluded_orders: Number(row.excluded_orders),
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
            SUM(${LINE_REVENUE}) AS revenue_ex_vat
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
  // Fritextrader är inga produkter och hoppas över här; tryck räknas som
  // en egen produkt ("Tryck & brodyr").
  const [rows] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT CASE WHEN ss.is_print = 1 THEN NULL ELSE p.id END AS product_id,
            ${ITEM_NAME} AS name,
            SUM(ss.quantity) AS total_qty,
            SUM(${LINE_REVENUE}) AS revenue_ex_vat,
            ${GROUP_MARGIN} AS margin_amount
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     WHERE ss.product_variant_id IS NOT NULL OR ss.is_print = 1
     GROUP BY 1, 2
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
     SELECT ${CATEGORY_ID} AS category_id, ${CATEGORY_NAME} AS name,
            SUM(ss.quantity) AS total_qty,
            SUM(${LINE_REVENUE}) AS revenue_ex_vat,
            ${GROUP_MARGIN} AS margin_amount
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     GROUP BY 1, 2
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
            ${CATEGORY_ID} AS category_id, ${CATEGORY_NAME} AS category_name,
            SUM(ss.quantity) AS total_qty,
            SUM(${LINE_REVENUE}) AS revenue_ex_vat
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     GROUP BY 1, 2, 3
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
  await expireOverdueQuotes();
  const [rows] = await pool.query(
    `SELECT q.id, q.quote_number, q.status, q.sent_at, c.name AS customer_name,
            COALESCE(SUM(ql.quantity * (ql.unit_price * (1 - ql.discount_percent / 100) - ql.discount_amount)), 0) AS total_value
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
            SUM(${LINE_REVENUE}) AS revenue_ex_vat,
            ${GROUP_MARGIN} AS margin_amount
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

// Rabatter: hur mycket som "ges bort" i rabatt (rabatt-% på raden, och på
// trycket), per kund och per produkt. gross = före rabatt.
export async function getDiscounts(rangeInput, limit = 20) {
  const range = defaultRange(rangeInput);
  const params = [...rangeParams(range), limit];
  const [byCustomer] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT c.id AS customer_id, c.name,
            SUM(${LINE_GROSS}) AS gross_ex_vat,
            SUM(${LINE_DISCOUNT}) AS discount_amount
     FROM sale_source ss
     JOIN customers c ON c.id = ss.customer_id
     GROUP BY c.id, c.name
     HAVING discount_amount > 0
     ORDER BY discount_amount DESC
     LIMIT ?`,
    params
  );
  const [byProduct] = await pool.query(
    `${SALE_SOURCE_CTE}
     SELECT CASE WHEN ss.is_print = 1 OR ss.product_variant_id IS NULL THEN NULL ELSE p.id END AS product_id,
            ${ITEM_NAME} AS name,
            SUM(${LINE_GROSS}) AS gross_ex_vat,
            SUM(${LINE_DISCOUNT}) AS discount_amount
     FROM sale_source ss
     LEFT JOIN product_variants v ON v.id = ss.product_variant_id
     LEFT JOIN products p ON p.id = v.product_id
     GROUP BY 1, 2
     HAVING discount_amount > 0
     ORDER BY discount_amount DESC
     LIMIT ?`,
    params
  );
  const shape = (r) => {
    const gross = Number(r.gross_ex_vat);
    const discount = Number(r.discount_amount);
    return {
      ...r,
      gross_ex_vat: round2(gross),
      discount_amount: round2(discount),
      discount_percent: gross > 0 ? round2((discount / gross) * 100) : 0,
    };
  };
  return { range, by_customer: byCustomer.map(shape), by_product: byProduct.map(shape) };
}
