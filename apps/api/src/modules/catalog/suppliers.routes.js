import { Router } from "express";
import { pool } from "../../lib/db.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id, name, email, phone FROM suppliers ORDER BY name ASC`);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.name) return res.status(400).json({ error: "name is required" });
    const [result] = await pool.query(`INSERT INTO suppliers (name, email, phone) VALUES (?, ?, ?)`, [
      req.body.name,
      req.body.email ?? null,
      req.body.phone ?? null,
    ]);
    res.status(201).json({ id: result.insertId, name: req.body.name, email: req.body.email ?? null, phone: req.body.phone ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
