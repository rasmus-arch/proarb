import { Router } from "express";
import * as stats from "./service.js";

// Statistik: bästsäljande produkter/kategorier/kunder + marginalberäkning,
// slår ihop kassaförsäljning (sale_lines) och order (order_lines). Alla
// belopp ex moms, per PLAN.md.
const router = Router();

function parseRange(req) {
  return { from: req.query.from, to: req.query.to };
}

router.get("/summary", async (req, res, next) => {
  try {
    res.json(await stats.getSummary(parseRange(req)));
  } catch (err) {
    next(err);
  }
});

router.get("/top-products", async (req, res, next) => {
  try {
    res.json(await stats.getTopProducts(parseRange(req), Number(req.query.limit) || 20));
  } catch (err) {
    next(err);
  }
});

router.get("/top-categories", async (req, res, next) => {
  try {
    res.json(await stats.getTopCategories(parseRange(req), Number(req.query.limit) || 20));
  } catch (err) {
    next(err);
  }
});

router.get("/top-customers", async (req, res, next) => {
  try {
    res.json(await stats.getTopCustomers(parseRange(req), Number(req.query.limit) || 20));
  } catch (err) {
    next(err);
  }
});

export default router;
