import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  DB_HOST = "localhost",
  DB_PORT = "3306",
  DB_USER = "proarb",
  DB_PASSWORD = "proarb",
  DB_NAME = "proarb",
} = process.env;

// Idempotent by design (CREATE TABLE IF NOT EXISTS, INSERT IGNORE) — safe
// to run again at any time, e.g. to bring a database up to date after a
// schema change, or to make sure the baseline seed data (warehouses, print
// methods, admin user) exists. This is what both `pnpm db:migrate` and the
// cPanel "Run NPM Install" button (via postinstall-seed.js) call.
export async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    // Shared hosting (e.g. cPanel) typically provisions the database ahead
    // of time via its own tooling and only grants the app's DB user rights
    // scoped to that already-existing database — not the server-wide
    // privilege to CREATE DATABASE. That's fine: just use it as-is.
    console.warn(
      `Kunde inte köra CREATE DATABASE (fortsätter mot befintlig databas "${DB_NAME}"): ${err.message}`
    );
  }

  await connection.changeUser({ database: DB_NAME });

  const schema = await readFile(path.join(__dirname, "schema.sql"), "utf8");
  console.log("Applying schema.sql ...");
  await connection.query(schema);

  // `CREATE TABLE IF NOT EXISTS` above only creates tables that don't exist
  // yet — it never alters an already-existing table. These ALTERs bring an
  // existing database up to date with columns/constraints/indexes added
  // after it was first created. Harmless no-ops on a fresh database, where
  // schema.sql already created all of this: "already exists" errors are
  // swallowed (1060 dup column, 1061 dup key/index name, 1826 dup FK
  // constraint name), everything else is logged but doesn't block the rest
  // of the migration.
  const alters = [
    "ALTER TABLE quote_lines MODIFY product_variant_id INT NULL",
    "ALTER TABLE quote_lines ADD COLUMN tax_rate_percent DECIMAL(5,2) NULL",
    "ALTER TABLE order_lines MODIFY product_variant_id INT NULL",
    "ALTER TABLE order_lines ADD COLUMN description VARCHAR(255) NULL AFTER product_variant_id",
    "ALTER TABLE order_lines ADD COLUMN tax_rate_percent DECIMAL(5,2) NULL",
    "ALTER TABLE sale_lines MODIFY product_variant_id INT NULL",
    "ALTER TABLE sale_lines ADD COLUMN description VARCHAR(255) NULL AFTER product_variant_id",
    "ALTER TABLE sale_lines ADD COLUMN tax_rate_percent DECIMAL(5,2) NULL",
    "ALTER TABLE products ADD COLUMN supplier_id INT NULL AFTER brand_id",
    "ALTER TABLE products ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)",
    "ALTER TABLE products ADD INDEX idx_products_supplier (supplier_id)",
    // Simplified order status flow: Order (NEW) -> Redo för utlämning ->
    // Utlämnad -> Fakturerad, plus Avbruten. Drops CONFIRMED/IN_PRODUCTION
    // (order status no longer gates on the print/tryck flow) and
    // PARTIALLY_DELIVERED (never reachable from the UI). Existing rows in
    // a dropped status are remapped first so the enum can be narrowed
    // without a strict-mode error.
    "UPDATE orders SET status = 'NEW' WHERE status IN ('CONFIRMED', 'IN_PRODUCTION')",
    "UPDATE orders SET status = 'READY_FOR_PICKUP' WHERE status = 'PARTIALLY_DELIVERED'",
    "ALTER TABLE orders MODIFY status ENUM('NEW','READY_FOR_PICKUP','DELIVERED','INVOICED','CANCELLED') NOT NULL DEFAULT 'NEW'",
    "ALTER TABLE purchase_order_lines ADD COLUMN line_status ENUM('OPEN','BACKORDERED','CLOSED') NOT NULL DEFAULT 'OPEN' AFTER received_qty",
    "ALTER TABLE purchase_orders MODIFY status VARCHAR(30) NOT NULL DEFAULT 'ORDERED'",
    "ALTER TABLE app_settings ADD COLUMN smtp_host VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN smtp_port INT NULL",
    "ALTER TABLE app_settings ADD COLUMN smtp_username VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN smtp_password VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN smtp_from_email VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN smtp_use_tls TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN fortnox_client_id VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN fortnox_client_secret VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN fortnox_access_token VARCHAR(500) NULL",
    "ALTER TABLE app_settings ADD COLUMN fortnox_refresh_token VARCHAR(500) NULL",
    "ALTER TABLE quote_lines ADD COLUMN print_price DECIMAL(10,2) NULL",
    "ALTER TABLE quote_lines ADD COLUMN print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0",
    "ALTER TABLE order_lines ADD COLUMN print_price DECIMAL(10,2) NULL",
    "ALTER TABLE order_lines ADD COLUMN print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0",
    "ALTER TABLE stock_levels ADD INDEX idx_sl_warehouse (warehouse_id)",
  ];
  for (const statement of alters) {
    try {
      await connection.query(statement);
    } catch (err) {
      if (![1060, 1061, 1826].includes(err.errno)) {
        console.warn(`Migreringssteg hoppades över (${statement}): ${err.message}`);
      }
    }
  }

  const seed = await readFile(path.join(__dirname, "seed.sql"), "utf8");
  console.log("Applying seed.sql ...");
  await connection.query(seed);

  // Opt-in only — fake customers/quotes/orders that show the full
  // kund → offert → order → tryckorder flow, for demoing the system.
  // Never applied unless explicitly asked for, so a real deployment never
  // gets surprise fake data. See DEPLOY-CPANEL.md.
  if (process.env.SEED_DEMO_DATA === "true") {
    const demoSeed = await readFile(path.join(__dirname, "demo-seed.sql"), "utf8");
    console.log("Applying demo-seed.sql (SEED_DEMO_DATA=true) ...");
    await connection.query(demoSeed);
  }

  console.log("Done.");
  await connection.end();
}

// Only run as a CLI entrypoint (`node migrate.js` / `pnpm db:migrate`) —
// postinstall-seed.js imports `run` directly instead, with its own
// non-fatal error handling.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
