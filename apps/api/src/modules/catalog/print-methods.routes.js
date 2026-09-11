import { Router } from "express";
import { pool } from "@proarb/db";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT id, name FROM print_methods ORDER BY name ASC`);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

export default router;
