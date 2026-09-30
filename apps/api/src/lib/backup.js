import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import mysql from "mysql2/promise";
import { uploadsRoot } from "./uploads.js";

// Nattlig säkerhetskopia: databasdump (gzippad SQL) + spegling av uploads/.
// Ren Node istället för mysqldump, som inte alltid finns på delade
// webbhotell. Kör via cron (scripts/backup.js) eller "Skapa säkerhetskopia
// nu" i Inställningar. Mappen ligger utanför webbroten.
export const backupDir = process.env.BACKUP_DIR || path.join(os.homedir(), "proarb-backups");
const DUMP_PATTERN = /^proarb-db-\d{4}-\d{2}-\d{2}_\d{4}\.sql\.gz$/;
const BATCH = 500;

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function* dumpDatabase() {
  const {
    DB_HOST = "localhost",
    DB_PORT = "3306",
    DB_USER = "proarb",
    DB_PASSWORD = "proarb",
    DB_NAME = "proarb",
  } = process.env;
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    charset: "utf8mb4",
    // Exakta värden tillbaka i dumpen: inga tidszons- eller
    // flyttalsomvandlingar på vägen.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    await connection.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");

    yield `-- ProArb säkerhetskopia ${new Date().toISOString()}\n`;
    yield "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n";

    const [tables] = await connection.query(`SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'`);
    for (const row of tables) {
      const table = Object.values(row)[0];
      const [[create]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      yield `DROP TABLE IF EXISTS \`${table}\`;\n${create["Create Table"]};\n\n`;

      for (let offset = 0; ; offset += BATCH) {
        const [rows] = await connection.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [BATCH, offset]);
        if (rows.length === 0) break;
        const columns = Object.keys(rows[0]).map((c) => `\`${c}\``).join(", ");
        const values = rows.map((r) => `(${Object.values(r).map((v) => connection.escape(v)).join(", ")})`).join(",\n");
        yield `INSERT INTO \`${table}\` (${columns}) VALUES\n${values};\n`;
        if (rows.length < BATCH) break;
      }
      yield "\n";
    }

    yield "SET FOREIGN_KEY_CHECKS = 1;\n";
    await connection.query("COMMIT");
  } finally {
    await connection.end();
  }
}

// Uploads byter aldrig innehåll under samma filnamn (slumpade namn), så en
// spegling räcker: kopiera det som saknas eller har ändrats.
function mirrorUploads(source, target) {
  if (!fs.existsSync(source)) return 0;
  fs.mkdirSync(target, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copied += mirrorUploads(from, to);
    } else if (entry.isFile()) {
      const src = fs.statSync(from);
      const dst = fs.existsSync(to) ? fs.statSync(to) : null;
      if (!dst || dst.size !== src.size || dst.mtimeMs < src.mtimeMs) {
        fs.copyFileSync(from, to);
        copied++;
      }
    }
  }
  return copied;
}

function pruneOldDumps(keepDays) {
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const name of fs.readdirSync(backupDir)) {
    if (!DUMP_PATTERN.test(name)) continue;
    const file = path.join(backupDir, name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.unlinkSync(file);
      removed++;
    }
  }
  return removed;
}

export async function createBackup({ keepDays = 14 } = {}) {
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const name = `proarb-db-${timestamp()}.sql.gz`;
  const file = path.join(backupDir, name);
  const partial = `${file}.partial`;
  try {
    await pipeline(Readable.from(dumpDatabase()), zlib.createGzip(), fs.createWriteStream(partial, { mode: 0o600 }));
    fs.renameSync(partial, file);
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }
  const uploadsCopied = mirrorUploads(uploadsRoot, path.join(backupDir, "uploads"));
  const removed = pruneOldDumps(Math.max(1, Number(keepDays) || 14));
  return { name, size: fs.statSync(file).size, uploadsCopied, removed };
}

export function listBackups() {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => DUMP_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(backupDir, name));
      return { name, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

// Only exact dump filenames resolve — never a path from the request.
export function backupFilePath(name) {
  if (!DUMP_PATTERN.test(name)) return null;
  const file = path.join(backupDir, name);
  return fs.existsSync(file) ? file : null;
}
