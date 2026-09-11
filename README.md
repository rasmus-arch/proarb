# ProArb

Affärssystem för butik/webshop inom arbetskläder och profilprodukter
(kunder, offerter, order, kassa, lager, produktkatalog). Se
[`PLAN.md`](PLAN.md) för fullständig kravspec och byggplan.

## Stack

- **Backend**: Node.js + Express (vanilla JS, `type: module`)
- **Databas**: MySQL, via `mysql2` (rå SQL, ingen ORM) – se
  [`packages/db/sql/schema.sql`](packages/db/sql/schema.sql)
- **Frontend**: vanilla JavaScript + Tailwind CSS (inget ramverk), statiska
  HTML-sidor som serveras direkt av Express
- **Monorepo**: pnpm workspaces (`apps/api`, `apps/web`, `packages/db`)

## Komma igång

Förutsätter Node.js 20+, pnpm och antingen Docker eller en lokal
MySQL/MariaDB-server.

```bash
pnpm install
cp .env.example .env

# Starta databasen (Docker)
docker compose up -d

# Skapa tabeller + minimal referensdata (lager, tryckmetoder, admin-användare)
pnpm db:migrate

# Bygg Tailwind-CSS en gång, eller kör dev-läge nedan för watch
pnpm css:build

# Starta API (serverar även frontend-sidorna) + Tailwind i watch-läge
pnpm dev
```

Öppna sedan http://localhost:3001 — Express serverar både API:t
(`/api/...`) och de statiska sidorna (`/kunder.html`, `/kassa.html`, osv.)
från samma process.

## Struktur

```
apps/
  api/   Express-API (src/modules/<domän>/{routes,service}.js)
  web/   Statiska HTML-sidor + vanilla JS (public/), Tailwind-källa (tailwind/)
packages/
  db/    SQL-schema, seed-data, migrationsscript, delad mysql2-pool
docker-compose.yml   MySQL för lokal utveckling
PLAN.md              Kravspec och fasindelad byggplan
```

## Status

Grundscaffold (Fas 0) plus en fungerande **kundmodul** (kort, kontakter med
hämtbehörighet) och en enkel **produktsökning**/**kassa-skanning**
(streckkod → slå upp variant). Offerter, ordrar och lager är stubbar —
se `PLAN.md` för fasplan och vad som återstår.
