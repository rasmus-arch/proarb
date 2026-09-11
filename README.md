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

- **Fas 0** – klar: grundscaffold, kundmodul (kort, kontakter med
  hämtbehörighet), produktsökning och kassa-skanning (streckkod → variant).
- **Fas 1** – klar: fullt CRUD på produkter/varianter, kategorier/varumärken,
  och CSV-bulkimport (batch-upsert, klarar stora kataloger).
- **Fas 2** – klar: offerter med rader (inkl. tryck), skicka, PDF, publik
  länk (`/q/:token`) utan inloggning där kunden kan acceptera/avböja, samt
  konvertering av accepterad offert till order.
- **Fas 3** – klar: order direkt eller via offert, statusflöde (ny →
  bekräftad → i produktion → klar för avhämtning → levererad → fakturerad)
  och utlämning registrerad mot en hämtberättigad kundkontakt (eller
  manuellt namn), med full utlämningshistorik.
- **Fas 4** – klar: kassasessioner (öppna/stänga med kassaavstämning),
  försäljning med streckkodsskanning, delad betalning (flera
  betalmetoder per köp) och PDF-kvitto. Betalmetod Faktura/Swish skapar
  automatiskt en Fortnox-fakturarad (kundfaktura respektive
  kontantfaktura) — själva Fortnox-anropet är en tydligt markerad stub
  tills en testmiljö finns, se `fortnox.js`.
- **Kundkort** – klar: kunddetaljsida med redigerbar info, hämtbehöriga
  kontakter, och fleruppladdning av namngivna logga-/tryckfiler
  (eps/jpg/png/svg/pdf).
- **Inställningar** – klar: säljarinfo/logga/accentfärg/fottext för
  offert-PDF och publik offertsida, samt på/av + intervall för
  e-postpåminnelser (själva utskicket kräver en SMTP-leverantör, ej
  kopplad).
- **Statistik** – klar: bästsäljande produkter/kategorier/kunder och
  marginal (kr + %) över valfri period, slår ihop kassa- och
  orderförsäljning.
- **Marginal** – visas nu i kassan, offert-editorn och order-editorn
  (per rad och som totalsumma), baserat på produktens inköpspris.
- **Fas 5** – klar: lagersaldo per lagerplats, inleverans mot inköpsorder
  via streckkodsskanning, en juridiskt spårbar inventering (skanna eller
  lägg in manuellt, avvikelselista inkl. det som *inte* blev skannat,
  radvis eller bulk-beslut att justera/behålla — allt som en auditerad
  `StockMovement`), samt inköpsförslag uppdelat per leverantör: dels
  orderrader utan lagertäckning eller markerade "beställ ändå", dels
  produkter under sitt min-saldo.
- **Fas 6** – klar: tryckkö (`/tryck.html`) som visar alla orderrader med
  tryckmetod oavsett order, filtrerbar på status (väntar/i produktion/
  klar), med statusövergångar (`WAITING → IN_PRODUCTION → READY`, samt
  en "backa"-möjlighet), och tryckinfo/status visas nu även i
  order-editorn.
- **Fas 7** – klar (utom själva Fortnox-anropet, se nedan): kundportal
  – en länk utan inloggning (`/portal/:token`, genereras från kundkortet)
  där kunden själv kan se sina offerter och ordrar – samt påminnelser om
  obesvarade offerter som en att-göra-lista på översiktssidan (ingen
  e-postleverantör kopplad, så "skicka påminnelse" innebär att ringa/
  maila manuellt och sen markera den som skickad).
- **Kvar**: riktig Fortnox-koppling (order → kundfaktura, synk tillbaka
  — stub finns i `fortnox.js`, väntar på testmiljö), härdning (auth,
  roller, GDPR — Fas 8). Mindre lucka: koppla produkt↔leverantör
  (backend klart, API:et `POST /api/products/:id/suppliers` finns, men
  saknar ännu en UI-formulär). Se `PLAN.md` för detaljer.
