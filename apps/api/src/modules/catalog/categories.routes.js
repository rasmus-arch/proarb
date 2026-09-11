import { Router } from "express";
import { pool } from "@proarb/db";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, parent_id FROM product_categories ORDER BY name ASC`
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.name) return res.status(400).json({ error: "name is required" });
    const [result] = await pool.query(
      `INSERT INTO product_categories (name, parent_id) VALUES (?, ?)`,
      [req.body.name, req.body.parentId ?? null]
    );
    res.status(201).json({ id: result.insertId, name: req.body.name, parent_id: req.body.parentId ?? null });
  } catch (err) {
    next(err);
  }
});

export default router;
