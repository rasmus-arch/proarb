import { pool } from "@proarb/db";
import { getQuote } from "../quotes/service.js";

function nextOrderNumber() {
  return `ORD-${Math.floor(Date.now() / 1000)}`;
}

// Fas 3 will flesh this module out (status flow, utlämning). For now it
// exists mainly to support "offert -> order"-konvertering (Fas 2) and to
// give ordrar.html something real to list.
export async function listOrders({ search = "", status = "", page = 1, pageSize = 25 }) {
  const offset = (page - 1) * pageSize;
  const like = `%${search}%`;
  const statusClause = status ? "AND o.status = ?" : "";
  const params = status ? [like, like, status, pageSize, offset] : [like, like, pageSize, offset];
  const countParams = status ? [like, like, status] : [like, like];

  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.delivery_method, o.created_at,
            c.id AS customer_id, c.name AS customer_name,
            COALESCE(SUM(ol.quantity * ol.unit_price * (1 - ol.discount_percent / 100)), 0) AS total_amount
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN order_lines ol ON ol.order_id = o.id
     WHERE (o.order_number LIKE ? OR c.name LIKE ?) ${statusClause}
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE (o.order_number LIKE ? OR c.name LIKE ?) ${statusClause}`,
    countParams
  );

  return { rows, total, page, pageSize };
}

export async function getOrder(id) {
  const [[order]] = await pool.query(
    `SELECT o.*, c.name AS customer_name, cc.name AS reference_name
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN customer_contacts cc ON cc.id = o.reference_contact_id
     WHERE o.id = ?`,
    [id]
  );
  if (!order) return null;

  const [lines] = await pool.query(
    `SELECT ol.*, p.name AS product_name, v.sku, v.color, v.size
     FROM order_lines ol
     JOIN product_variants v ON v.id = ol.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE ol.order_id = ?
     ORDER BY ol.sort_order ASC, ol.id ASC`,
    [id]
  );

  return { ...order, lines };
}

export async function convertQuoteToOrder(quoteId, userId) {
  const quote = await getQuote(quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  if (quote.status === "CONVERTED") throw new Error("QUOTE_ALREADY_CONVERTED");
  if (quote.status !== "ACCEPTED") throw new Error("QUOTE_NOT_ACCEPTED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_id, reference_contact_id, quote_id, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [nextOrderNumber(), quote.customer_id, quote.reference_contact_id, quote.id, userId]
    );
    const orderId = result.insertId;

    let sortOrder = 0;
    for (const line of quote.lines) {
      await connection.query(
        `INSERT INTO order_lines
           (order_id, product_variant_id, quantity, unit_price, discount_percent, print_method_id, print_description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          line.product_variant_id,
          line.quantity,
          line.unit_price,
          line.discount_percent,
          line.print_method_id,
          line.print_description,
          sortOrder++,
        ]
      );
    }

    await connection.query(`UPDATE quotes SET status = 'CONVERTED' WHERE id = ?`, [quote.id]);

    await connection.commit();
    return getOrder(orderId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
