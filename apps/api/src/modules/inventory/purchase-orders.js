import { pool } from "../../lib/db.js";
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
      `INSERT INTO purchase_orders (supplier_id, status, expected_date) VALUES (?, 'ORDERED', ?)`,
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

    await recomputePoStatus(connection, poId, po.status);

    await connection.commit();
    return getPurchaseOrder(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// A line counts as "done" once it's fully received OR staff explicitly
// closed out the remainder (line_status CLOSED — see submitReceiving).
// A BACKORDERED line is still outstanding, so the PO stays
// PARTIALLY_RECEIVED until that's resolved one way or the other.
async function recomputePoStatus(connection, poId, currentStatus) {
  const [lines] = await connection.query(
    `SELECT quantity, received_qty, line_status FROM purchase_order_lines WHERE purchase_order_id = ?`,
    [poId]
  );
  const allDone = lines.every((l) => Number(l.received_qty) >= Number(l.quantity) || l.line_status === "CLOSED");
  const anyReceived = lines.some((l) => Number(l.received_qty) > 0);
  const newStatus = allDone ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : currentStatus;
  if (newStatus !== currentStatus) {
    await connection.query(`UPDATE purchase_orders SET status = ? WHERE id = ?`, [newStatus, poId]);
  }
}

// Line-by-line manual receiving (the "Inleverans" review form), as an
// alternative/complement to scan-to-receive: staff checks off how many of
// each line actually arrived just now, and for anything short of the
// full ordered quantity, explicitly says whether the rest is still
// coming (BACKORDER) or should be dropped from the order (REMOVE — lowers
// the line's quantity to what was actually received, so the PO can reach
// RECEIVED instead of sitting open forever).
export async function submitReceiving(poId, { lines, warehouseId, userId }) {
  const po = await getPurchaseOrder(poId);
  if (!po) throw new Error("PO_NOT_FOUND");
  if (po.status === "RECEIVED") throw new Error("PO_ALREADY_RECEIVED");
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("NO_LINES");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const input of lines) {
      const line = po.lines.find((l) => l.id === Number(input.lineId));
      if (!line) continue;

      const receivedNow = Number(input.receivedQty) || 0;
      if (receivedNow < 0) throw new Error("INVALID_QUANTITY");

      if (receivedNow > 0) {
        await connection.query(`UPDATE purchase_order_lines SET received_qty = received_qty + ? WHERE id = ?`, [
          receivedNow,
          line.id,
        ]);
        await recordMovement(connection, {
          variantId: line.product_variant_id,
          warehouseId,
          type: "PURCHASE_IN",
          quantityDelta: receivedNow,
          referenceType: "purchase_order",
          referenceId: poId,
          userId,
        });
      }

      const totalReceived = Number(line.received_qty) + receivedNow;
      const stillOutstanding = totalReceived < Number(line.quantity);

      if (stillOutstanding && input.action === "REMOVE") {
        await connection.query(`UPDATE purchase_order_lines SET quantity = ?, line_status = 'CLOSED' WHERE id = ?`, [
          totalReceived,
          line.id,
        ]);
      } else if (stillOutstanding && input.action === "BACKORDER") {
        await connection.query(`UPDATE purchase_order_lines SET line_status = 'BACKORDERED' WHERE id = ?`, [line.id]);
      } else if (!stillOutstanding) {
        await connection.query(`UPDATE purchase_order_lines SET line_status = 'OPEN' WHERE id = ?`, [line.id]);
      }
    }

    await recomputePoStatus(connection, poId, po.status);

    await connection.commit();
    return getPurchaseOrder(poId);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
