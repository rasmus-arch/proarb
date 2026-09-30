// Körs av cron i cPanel, t.ex. varje natt kl 03:
//   cd ~/proarb/apps/api && ~/nodevenv/proarb/22/bin/node scripts/backup.js
// Läser samma DB_*-miljövariabler som appen (lägg dem i cron-raden eller
// en .env om de inte redan finns i skalet). Se DEPLOY-CPANEL.md.
import { createBackup, backupDir } from "../src/lib/backup.js";
import { getSettings } from "../src/modules/settings/service.js";
import { pool } from "../src/lib/db.js";

try {
  const settings = await getSettings();
  const result = await createBackup({ keepDays: settings?.backup_keep_days });
  console.log(
    `Säkerhetskopia klar: ${backupDir}/${result.name} (${Math.round(result.size / 1024)} kB), ` +
      `${result.uploadsCopied} nya/ändrade filer i uploads, ${result.removed} gamla kopior borttagna.`
  );
} catch (err) {
  console.error(`Säkerhetskopian misslyckades: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
