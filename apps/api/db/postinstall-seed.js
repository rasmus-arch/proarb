import { run } from "./migrate.js";

// Runs the same schema+seed migration as `pnpm db:migrate`, but never
// fails the install itself — this is invoked as apps/api's "postinstall"
// script, which fires on every `npm install` (locally via pnpm too). Two
// cases that must not break `npm install`:
//   - local dev, first `pnpm install` right after cloning, before the
//     database container even exists yet (see README "Komma igång")
//   - a cPanel deploy where DB_* env vars aren't set yet or are wrong —
//     the failure should be visible in the install log, not abort the
//     whole "Run NPM Install" step (which would also skip installing the
//     app's actual dependencies).
// On real misconfiguration the app will separately fail at runtime
// (visible 500s), same as it always would have without this step.
try {
  await run();
} catch (err) {
  console.warn(
    `\nOBS: kunde inte köra databasmigrering/seedning automatiskt (${err.message}).\n` +
      "Om databasen redan finns och miljövariablerna (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) ser korrekta ut,\n" +
      "kan du köra om det senare (t.ex. via \"Run NPM Install\" i cPanel igen, eller `pnpm db:migrate` lokalt).\n"
  );
}
