import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";

import customersRouter from "./modules/customers/routes.js";
import quotesRouter from "./modules/quotes/routes.js";
import quotesPublicRouter, { renderPublicQuotePage, renderPublicQuotePdf } from "./modules/quotes/public.js";
import ordersRouter from "./modules/orders/routes.js";
import productsRouter from "./modules/products/routes.js";
import categoriesRouter from "./modules/catalog/categories.routes.js";
import brandsRouter from "./modules/catalog/brands.routes.js";
import printMethodsRouter from "./modules/catalog/print-methods.routes.js";
import posRouter from "./modules/pos/routes.js";
import inventoryRouter from "./modules/inventory/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webPublicDir = path.join(__dirname, "..", "..", "web", "public");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/customers", customersRouter);
app.use("/api/quotes", quotesRouter);
app.use("/api/public/quotes", quotesPublicRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/brands", brandsRouter);
app.use("/api/print-methods", printMethodsRouter);
app.use("/api/pos", posRouter);
app.use("/api/inventory", inventoryRouter);

// Public, no-login quote link shared with customers (see PLAN.md §3).
app.get("/q/:token", renderPublicQuotePage);
app.get("/q/:token/pdf", renderPublicQuotePdf);

// Serve the vanilla JS + Tailwind frontend.
app.use(express.static(webPublicDir));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? "Internal server error" });
});

const port = process.env.PORT ?? 3001;
app.listen(port, () => {
  console.log(`ProArb API listening on http://localhost:${port}`);
});
