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
    // Single-warehouse simplification: only remove Centrallager if nothing
    // actually references it (a real deployment with stock/history there
    // keeps the row — never silently destroy real data), so this is a
    // no-op everywhere except a fresh/never-used second warehouse.
    `DELETE FROM warehouses WHERE name = 'Centrallager'
       AND id NOT IN (SELECT DISTINCT warehouse_id FROM stock_levels)
       AND id NOT IN (SELECT DISTINCT warehouse_id FROM stock_movements)
       AND id NOT IN (SELECT DISTINCT warehouse_id FROM stock_counts)`,
    "ALTER TABLE app_settings ADD COLUMN portal_show_stock TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE app_settings ADD COLUMN inactive_customer_months INT NOT NULL DEFAULT 6",
    "ALTER TABLE invoices MODIFY type ENUM('CUSTOMER_INVOICE', 'CASH_INVOICE', 'CREDIT_INVOICE') NOT NULL DEFAULT 'CUSTOMER_INVOICE'",
    "ALTER TABLE app_settings ADD COLUMN auto_print_order_slip TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN pickup_qr_token VARCHAR(64) NULL UNIQUE",
    "ALTER TABLE portal_order_requests ADD COLUMN reference_contact_id INT NULL, ADD CONSTRAINT fk_por_contact FOREIGN KEY (reference_contact_id) REFERENCES customer_contacts(id)",
    "ALTER TABLE app_settings ADD COLUMN next_order_number INT NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN next_quote_number INT NOT NULL DEFAULT 1",
    "ALTER TABLE customers ADD COLUMN invoice_email VARCHAR(255) NULL AFTER email",
    "ALTER TABLE app_settings ADD COLUMN github_issues_token VARCHAR(255) NULL",
    "ALTER TABLE app_settings ADD COLUMN github_issues_repo VARCHAR(255) NULL",
    "ALTER TABLE customer_assortment ADD COLUMN print_description VARCHAR(255) NULL",
    "ALTER TABLE customer_assortment ADD COLUMN print_price DECIMAL(10,2) NULL",
    "ALTER TABLE customer_assortment ADD COLUMN print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0",
    "ALTER TABLE customers ADD COLUMN fortnox_customer_number VARCHAR(20) NULL",
    "ALTER TABLE app_settings ADD COLUMN fortnox_token_expires_at DATETIME NULL",
    "ALTER TABLE app_settings ADD COLUMN fortnox_oauth_state VARCHAR(64) NULL",
    "ALTER TABLE orders ADD COLUMN skip_inventory TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN ready_at DATETIME NULL",
    "ALTER TABLE suppliers ADD COLUMN contact_name VARCHAR(255) NULL",
    "ALTER TABLE suppliers ADD COLUMN customer_number VARCHAR(100) NULL",
    "ALTER TABLE suppliers ADD COLUMN lead_time_days INT NULL",
    "ALTER TABLE suppliers ADD COLUMN notes TEXT NULL",
    "ALTER TABLE purchase_orders ADD COLUMN sent_at DATETIME NULL",
    "ALTER TABLE purchase_orders ADD COLUMN sent_to VARCHAR(255) NULL",
    "ALTER TABLE orders ADD COLUMN pickup_reminder_sent_at DATETIME NULL",
    "ALTER TABLE app_settings ADD COLUMN quote_valid_days INT NOT NULL DEFAULT 10",
    "ALTER TABLE app_settings ADD COLUMN quote_expiry_warning_days INT NOT NULL DEFAULT 3",
    "ALTER TABLE app_settings ADD COLUMN margin_warning_percent DECIMAL(5,2) NOT NULL DEFAULT 25",
    "ALTER TABLE app_settings ADD COLUMN margin_critical_percent DECIMAL(5,2) NOT NULL DEFAULT 10",
    "ALTER TABLE app_settings ADD COLUMN pickup_reminder_days INT NOT NULL DEFAULT 7",
    "ALTER TABLE app_settings ADD COLUMN default_payment_terms_days INT NOT NULL DEFAULT 30",
    "ALTER TABLE app_settings ADD COLUMN default_tax_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 25",
    "ALTER TABLE app_settings ADD COLUMN quote_number_prefix VARCHAR(10) NOT NULL DEFAULT 'OFF'",
    "ALTER TABLE app_settings ADD COLUMN order_number_prefix VARCHAR(10) NOT NULL DEFAULT 'ORD'",
    "ALTER TABLE app_settings ADD COLUMN order_ready_email_note VARCHAR(1000) NULL",
    "ALTER TABLE app_settings ADD COLUMN purchase_order_email_note VARCHAR(1000) NULL",
    "ALTER TABLE app_settings ADD COLUMN backup_keep_days INT NOT NULL DEFAULT 14",
    "ALTER TABLE customers ADD COLUMN is_cash_customer TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE app_settings ADD COLUMN fortnox_cash_payment_way VARCHAR(20) NULL",
    "ALTER TABLE order_lines ADD COLUMN cost_price DECIMAL(10,2) NULL",
    "ALTER TABLE quote_lines ADD COLUMN cost_price DECIMAL(10,2) NULL",
    "ALTER TABLE order_template_lines ADD COLUMN cost_price DECIMAL(10,2) NULL",
    "ALTER TABLE app_settings ADD COLUMN portal_require_login TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN discontinued TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE stock_counts ADD COLUMN scope_type VARCHAR(20) NOT NULL DEFAULT 'FULL'",
    "ALTER TABLE stock_counts ADD COLUMN scope_id INT NULL",
    "ALTER TABLE stock_counts ADD COLUMN scope_label VARCHAR(255) NULL",
    "ALTER TABLE quote_lines ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE order_lines ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE order_template_lines ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE order_return_lines ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE portal_order_request_lines ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0",
    "ALTER TABLE portal_order_request_lines ADD COLUMN print_description VARCHAR(255) NULL",
    "ALTER TABLE portal_order_request_lines ADD COLUMN print_price DECIMAL(10,2) NULL",
    "ALTER TABLE portal_order_request_lines ADD COLUMN print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0",
    "ALTER TABLE customer_assortment ADD COLUMN discount_percent DECIMAL(5,2) NULL",
    "ALTER TABLE customer_assortment ADD COLUMN discount_amount DECIMAL(10,2) NULL",
    // Fortnox access token (JWT) är längre än 500 tecken och kapades tyst.
    "ALTER TABLE app_settings MODIFY fortnox_access_token TEXT NULL",
    "ALTER TABLE app_settings MODIFY fortnox_refresh_token TEXT NULL",
    "ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE app_settings ADD COLUMN notify_request_received TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN notify_order_confirmed TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN notify_order_delivered TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE app_settings ADD COLUMN fortnox_payment_status_enabled TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN fortnox_unpaid_synced_at DATETIME NULL",
    "ALTER TABLE app_settings ADD COLUMN credit_limits_enabled TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE app_settings ADD COLUMN shelf_locations_enabled TINYINT(1) NOT NULL DEFAULT 1",
    "ALTER TABLE customers ADD COLUMN credit_limit DECIMAL(12,2) NULL",
    "ALTER TABLE products ADD COLUMN shelf_location VARCHAR(50) NULL",
    "ALTER TABLE portal_order_requests ADD COLUMN requester_email VARCHAR(255) NULL",
    "ALTER TABLE orders ADD COLUMN notify_email VARCHAR(255) NULL",
    "ALTER TABLE orders ADD COLUMN customer_reference VARCHAR(50) NULL",
    "ALTER TABLE orders ADD COLUMN cost_center VARCHAR(30) NULL",
    "ALTER TABLE portal_order_requests ADD COLUMN customer_reference VARCHAR(50) NULL",
    "ALTER TABLE portal_order_requests ADD COLUMN cost_center VARCHAR(30) NULL",
    "ALTER TABLE portal_order_requests ADD COLUMN pickup_email VARCHAR(255) NULL",
    "ALTER TABLE purchase_orders ADD COLUMN confirmed_at DATETIME NULL",
    "ALTER TABLE purchase_orders ADD COLUMN confirmed_note VARCHAR(255) NULL",
    "ALTER TABLE invoices ADD COLUMN paid_at DATETIME NULL",
    "ALTER TABLE app_settings ADD COLUMN obsolete_stock_months INT NOT NULL DEFAULT 12",
    // Swish-kunden för småköp — skapas en gång. Finns det redan en
    // kontantkund (eller kundnummer SWISH) görs ingenting, så en omdöpt
    // eller borttagen Swish-kund dyker aldrig upp igen.
    `INSERT INTO customers (customer_number, name, is_cash_customer, payment_terms_days, notes)
     SELECT 'SWISH', 'Swish-kund', 1, 0, 'Småköp som betalas med Swish. Utlämning skapar en kontantfaktura i Fortnox som inte skickas.'
     FROM DUAL
     WHERE NOT EXISTS (SELECT 1 FROM customers WHERE is_cash_customer = 1 OR customer_number = 'SWISH')`,
  ];
  for (const statement of alters) {
    try {
      await connection.query(statement);
    } catch (err) {
      // MariaDB reports a duplicate FK constraint as errno 1005 wrapping
      // "errno: 121" instead of MySQL's 1826.
      const duplicateFk = err.errno === 1005 && /errno: 121/.test(err.message);
      if (![1060, 1061, 1826].includes(err.errno) && !duplicateFk) {
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
