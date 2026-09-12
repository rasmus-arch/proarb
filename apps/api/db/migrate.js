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

  const seed = await readFile(path.join(__dirname, "seed.sql"), "utf8");
  console.log("Applying seed.sql ...");
  await connection.query(seed);

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
