import { Router } from "express";
import { pool } from "../../lib/db.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id, name FROM brands ORDER BY name ASC`);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.name) return res.status(400).json({ error: "name is required" });
    const [result] = await pool.query(`INSERT INTO brands (name) VALUES (?)`, [req.body.name]);
    res.status(201).json({ id: result.insertId, name: req.body.name });
  } catch (err) {
    next(err);
  }
});

export default router;
