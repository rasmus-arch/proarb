import { pool } from "../../lib/db.js";
import { getOrder, createOrder } from "./service.js";

// "Program" — a named, reusable set of order lines per customer (e.g.
// "Vinteruniform 2026"), not a copy of one specific past order. Saved
// once from an existing order, then used to spin up a fresh order any
// number of times later (quantities/prices can still be adjusted on the
// new order same as any other — this just saves re-picking every line).

export async function listOrderTemplates(customerId) {
  const [rows] = await pool.query(
    `SELECT ot.id, ot.name, ot.created_at, COUNT(otl.id) AS line_count
     FROM order_templates ot
     LEFT JOIN order_template_lines otl ON otl.template_id = ot.id
     WHERE ot.customer_id = ?
     GROUP BY ot.id
     ORDER BY ot.created_at DESC`,
    [customerId]
  );
  return rows;
}

export async function saveOrderAsTemplate(orderId, name, userId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (!name?.trim()) throw new Error("NAME_REQUIRED");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO order_templates (customer_id, name, created_by) VALUES (?, ?, ?)`,
      [order.customer_id, name.trim(), userId]
    );
    const templateId = result.insertId;

    let sortOrder = 0;
    for (const line of order.lines) {
      await connection.query(
        `INSERT INTO order_template_lines
           (template_id, product_variant_id, description, quantity, unit_price, discount_percent, tax_rate_percent, print_description, print_price, print_discount_percent, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId,
          line.product_variant_id,
          line.product_variant_id ? null : line.description,
          line.quantity,
          line.unit_price,
          line.discount_percent,
          line.tax_rate_percent,
          line.print_description,
          line.print_price,
          line.print_discount_percent,
          sortOrder++,
        ]
      );
    }

    await connection.commit();
    return { id: templateId };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function createOrderFromTemplate(templateId, userId) {
  const [[template]] = await pool.query(`SELECT * FROM order_templates WHERE id = ?`, [templateId]);
  if (!template) throw new Error("TEMPLATE_NOT_FOUND");

  const [lines] = await pool.query(
    `SELECT * FROM order_template_lines WHERE template_id = ? ORDER BY sort_order ASC, id ASC`,
    [templateId]
  );

  return createOrder(
    {
      customerId: template.customer_id,
      notes: `Skapad från mall "${template.name}".`,
      lines: lines.map((l) => ({
        productVariantId: l.product_variant_id,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent,
        taxRatePercent: l.tax_rate_percent,
        printDescription: l.print_description,
        printPrice: l.print_price,
        printDiscountPercent: l.print_discount_percent,
        sourcing: "STOCK",
      })),
    },
    userId
  );
}

export async function deleteOrderTemplate(templateId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM order_template_lines WHERE template_id = ?`, [templateId]);
    const [result] = await connection.query(`DELETE FROM order_templates WHERE id = ?`, [templateId]);
    await connection.commit();
    if (result.affectedRows === 0) throw new Error("TEMPLATE_NOT_FOUND");
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
