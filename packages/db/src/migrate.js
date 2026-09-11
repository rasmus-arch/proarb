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

async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.changeUser({ database: DB_NAME });

  const schema = await readFile(path.join(__dirname, "..", "sql", "schema.sql"), "utf8");
  console.log("Applying schema.sql ...");
  await connection.query(schema);

  const seed = await readFile(path.join(__dirname, "..", "sql", "seed.sql"), "utf8");
  console.log("Applying seed.sql ...");
  await connection.query(seed);

  console.log("Done.");
  await connection.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
