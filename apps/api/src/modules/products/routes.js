import { Router } from "express";
import * as products from "./service.js";

// Fas 1 (grund): sökbar produkt-/variantlista + slå upp variant via
// streckkod (används av kassan). Fullt CRUD, bulkimport, prislistor,
// lagersaldo per plats och statistik över bästsäljare kommer i senare
// faser, se PLAN.md.
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const { search = "", page = "1", pageSize = "25" } = req.query;
    const result = await products.listProducts({
      search: String(search),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/by-barcode/:barcode", async (req, res, next) => {
  try {
    const variant = await products.findVariantByBarcode(req.params.barcode);
    if (!variant) return res.status(404).json({ error: "Ingen produkt med den streckkoden" });
    res.json(variant);
  } catch (err) {
    next(err);
  }
});

export default router;
