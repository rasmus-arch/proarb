import { pool } from "@proarb/db";
import { recordMovement } from "./service.js";

export async function listPurchaseOrders({ status = "" }) {
  const where = status ? "WHERE po.status = ?" : "";
  const params = status ? [status] : [];
  const [rows] = await pool.query(
    `SELECT po.id, po.status, po.expected_date, po.created_at, s.id AS supplier_id, s.name AS supplier_name,
            COALESCE(SUM(pol.quantity), 0) AS total_qty,
            COALESCE(SUM(pol.received_qty), 0) AS total_received_qty
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_order_lines pol ON pol.purchase_order_id = po.id
     ${where}
     GROUP BY po.id
     ORDER BY po.created_at DESC`,
    params
  );
  return rows;
}

export async function getPurchaseOrder(id) {
  const [[po]] = await pool.query(
    `SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`,
    [id]
  );
  if (!po) return null;

  const [lines] = await pool.query(
    `SELECT pol.*, v.sku, v.barcode, v.color, v.size, p.name AS product_name
     FROM purchase_order_lines pol
     JOIN product_variants v ON v.id = pol.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE pol.purchase_order_id = ?
     ORDER BY pol.id ASC`,
    [id]
  );

  return { ...po, lines };
}

export async function createPurchaseOrder({ supplierId, expectedDate, lines }) {
  if (!supplierId || !Array.isArray(lines) || lines.length === 0) {
    throw new Error("INVALID_PURCHASE_ORDER");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO purchase_orders (supplier_id, expected_date) VALUES (?, ?)`,
      [supplierId, expectedDate ?? null]
    );
    const poId = result.insertId;

    for (const line of lines) {
      await connection.query(
        `INSERT INTO purchase_order_lines (purchase_order_id, product_variant_id, quantity, cost_price)
         VALUES (?, ?, ?, ?)`,
        [poId, line.productVariantId, line.quantity, line.costPrice]
      );
    }

    await connection.commit();
    return getPurchaseOrder(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// Scan-to-receive: matches a scanned barcode against this PO's lines and
// books the received quantity as a PURCHASE_IN stock movement. Receiving
// more than ordered is allowed (common with case-pack rounding) but the
// line is capped from driving the PO to RECEIVED beyond what was ordered
// is fine — received_qty can simply exceed quantity.
export async function receiveByBarcode(poId, { barcode, quantity = 1, warehouseId, userId }) {
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("PO_NOT_FOUND");
  if (po.status === "RECEIVED") throw new Error("PO_ALREADY_RECEIVED");

  const line = po.lines.find((l) => l.barcode === barcode);
  if (!line) throw new Error("BARCODE_NOT_ON_ORDER");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query(`UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?`, [
      quantity,
      line.id,
    ]);

    await recordMovement(connection, {
      variantId: line.product_variant_id,
      warehouseId,
      type: "PURCHASE_IN",
      quantityDelta: quantity,
      referenceType: "purchase_order",
      referenceId: poId,
      userId,
    });

    const [updatedLines] = await connection.query(
      `SELECT quantity, received_qty FROM purchase_order_lines WHERE purchase_order_id = ?`,
      [poId]
    );
    const allReceived = updatedLines.every((l) => Number(l.received_qty) >= Number(l.quantity));
    const anyReceived = updatedLines.some((l) => Number(l.received_qty) > 0);
    const newStatus = allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;
    if (newStatus !== po.status) {
      await connection.query(`UPDATE purchase_orders SET status = ? WHERE id = ?`, [newStatus, poId]);
    }

    await connection.commit();
    return getPurchaseOrder(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
