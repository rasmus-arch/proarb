import { Router } from "express";
import multer from "multer";
import * as products from "./service.js";
import { importProductsCsv } from "./import.js";

// Fas 1: sökbar produkt-/variantlista, fullt CRUD på produkt+varianter,
// slå upp variant via streckkod (kassan) och bulkimport från CSV.
// Prislistor och lagersaldo per plats kommer i senare faser, se PLAN.md.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

router.get("/search", async (req, res, next) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const rows = await products.searchVariants(String(req.query.q ?? ""), Number(req.query.limit) || 15, customerId);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.get("/by-barcode/:barcode", async (req, res, next) => {
  try {
    const customerId = req.query.customerId ? Number(req.query.customerId) : null;
    const variant = await products.findVariantByBarcode(req.params.barcode, customerId);
    if (!variant) return res.status(404).json({ error: "Ingen produkt med den streckkoden" });
    res.json(variant);
  } catch (err) {
    next(err);
  }
});

router.post("/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Ingen fil bifogad (fältnamn: file)" });
    const summary = await importProductsCsv(req.file.buffer);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!req.body?.name || req.body?.basePrice === undefined) {
      return res.status(400).json({ error: "name och basePrice krävs" });
    }
    if (!req.body?.supplierId && !req.body?.supplier?.trim()) {
      return res.status(400).json({ error: "Leverantör krävs" });
    }
    const product = await products.createProduct(req.body);
    res.status(201).json(product);
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Artikelnummer, SKU eller streckkod finns redan" });
    }
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const product = await products.getProduct(Number(req.params.id));
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const product = await products.updateProduct(Number(req.params.id), req.body ?? {});
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await products.deactivateProduct(Number(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post("/:id/variants", async (req, res, next) => {
  try {
    if (!req.body) return res.status(400).json({ error: "body krävs" });
    const variant = await products.addVariant(Number(req.params.id), req.body);
    res.status(201).json(variant);
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "SKU eller streckkod finns redan" });
    }
    next(err);
  }
});

router.post("/:id/suppliers", async (req, res, next) => {
  try {
    if (!req.body?.supplierId) return res.status(400).json({ error: "supplierId krävs" });
    const product = await products.addSupplier(Number(req.params.id), req.body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

export default router;
