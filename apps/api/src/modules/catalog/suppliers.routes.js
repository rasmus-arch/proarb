import { Router } from "express";
import { pool } from "../../lib/db.js";

const router = Router();

function supplierFields(body) {
  const text = (v) => (v === undefined ? undefined : String(v ?? "").trim() || null);
  const leadTime = body.leadTimeDays === undefined ? undefined : body.leadTimeDays === "" || body.leadTimeDays === null ? null : Number(body.leadTimeDays);
  return {
    name: body.name === undefined ? undefined : String(body.name).trim(),
    email: text(body.email),
    phone: text(body.phone),
    contact_name: text(body.contactName),
    customer_number: text(body.customerNumber),
    lead_time_days: Number.isFinite(leadTime) || leadTime === null ? leadTime : undefined,
    notes: text(body.notes),
  };
}

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.email, s.phone, s.contact_name, s.customer_number, s.lead_time_days, s.notes,
              (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.active = 1) AS product_count,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = s.id AND po.status != 'RECEIVED') AS open_po_count
       FROM suppliers s
       ORDER BY s.name ASC`
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const fields = supplierFields(req.body ?? {});
    if (!fields.name) return res.status(400).json({ error: "Namn krävs" });
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    const [result] = await pool.query(
      `INSERT INTO suppliers (${entries.map(([c]) => c).join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`,
      entries.map(([, v]) => v)
    );
    const [[supplier]] = await pool.query(`SELECT * FROM suppliers WHERE id = ?`, [result.insertId]);
    res.status(201).json(supplier);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const fields = supplierFields(req.body ?? {});
    if (fields.name === "") return res.status(400).json({ error: "Namn krävs" });
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      await pool.query(`UPDATE suppliers SET ${entries.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`, [
        ...entries.map(([, v]) => v),
        Number(req.params.id),
      ]);
    }
    const [[supplier]] = await pool.query(`SELECT * FROM suppliers WHERE id = ?`, [Number(req.params.id)]);
    if (!supplier) return res.status(404).json({ error: "Not found" });
    res.json(supplier);
  } catch (err) {
    next(err);
  }
});

// Bara leverantörer som inte används någonstans kan tas bort — annars
// skulle produkter, inköpsordrar och rabatter tappa sin koppling.
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [[usage]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM products WHERE supplier_id = ?)
            + (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ?)
            + (SELECT COUNT(*) FROM product_suppliers WHERE supplier_id = ?)
            + (SELECT COUNT(*) FROM customer_discounts WHERE supplier_id = ?) AS used`,
      [id, id, id, id]
    );
    if (usage.used > 0) {
      return res.status(409).json({ error: "Leverantören används av produkter, inköpsordrar eller rabatter och kan inte tas bort" });
    }
    await pool.query(`DELETE FROM suppliers WHERE id = ?`, [id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
