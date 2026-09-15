# ProArb

Affärssystem för butik/webshop inom arbetskläder och profilprodukter
(kunder, offerter, order, kassa, lager, produktkatalog). Se
[`PLAN.md`](PLAN.md) för fullständig kravspec och byggplan.

## Stack

- **Backend**: Node.js + Express (vanilla JS, `type: module`)
- **Databas**: MySQL, via `mysql2` (rå SQL, ingen ORM) – se
  [`apps/api/db/schema.sql`](apps/api/db/schema.sql)
- **Frontend**: vanilla JavaScript + Tailwind CSS (inget ramverk), statiska
  HTML-sidor som serveras direkt av Express
- **Monorepo**: pnpm/npm workspaces (`apps/api`, `apps/web`) – `apps/api`
  är en helt fristående Node-app utan interna paketberoenden, så den
  går att installera med vanlig `npm install` på vilken host som helst

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
från samma process. Du landar på `/login.html`; logga in med
`admin@example.com` / `changeme` (byt lösenord under Inställningar →
Användare).

## Publicera (t.ex. cPanel)

Se [`DEPLOY-CPANEL.md`](DEPLOY-CPANEL.md) — en riktig, återanvändbar
publiceringsväg utan SSH: hämta koden (git eller zip), kör `npm install`
i cPanels Node.js Selector med *Application root* satt till `apps/api`.
Det installerar beroenden **och** migrerar/seedar databasen automatiskt
(idempotent, säkert att köra om när ni uppdaterar). `apps/api` är en
helt fristående app (inga interna paketberoenden), så det fungerar med
vilken npm-version som helst, utan pnpm på servern.

## Struktur

```
apps/
  api/   Express-API (src/modules/<domän>/{routes,service}.js)
         db/  SQL-schema, seed-data, migrationsscript (körs som postinstall)
  web/   Statiska HTML-sidor + vanilla JS (public/), Tailwind-källa (tailwind/)
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
- **Fritextrader & snabbskapade produkter** – klar: i offert-editorn,
  order-editorn och kassan kan man nu lägga till en fritextrad (egen
  beskrivning, antal, pris och momssats, utan att den behöver finnas som
  produkt) samt skapa en ny produkt direkt i flödet (namn och pris räcker
  — artikelnummer och SKU genereras automatiskt om de utelämnas) och
  lägga till den som rad på en gång. Kassan har dessutom fått fritextsök
  på produktnamn/artikelnummer/SKU, inte bara streckkodsskanning.
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
- **Fas 8** – klar: riktig inloggning (e-post/lösenord, bcrypt-hashat,
  session i en `sessions`-tabell bakom en HttpOnly-cookie — inte JWT,
  så en utloggning/inaktivering slår igenom direkt). Alla `/api`-rutter
  utom `/api/auth/*` och de publika offert-svaren kräver en inloggad
  session. Fyra roller (ADMIN/SALES/WAREHOUSE/POS): Inställningar och
  användarhantering kräver ADMIN, att ändra lagersaldo (justera,
  inventering, ta emot inköpsorder) kräver WAREHOUSE eller ADMIN.
  Användare hanteras under Inställningar → Användare (endast ADMIN).
  Standardkontot är `admin@example.com` / `changeme` — byt lösenord
  där efter första inloggningen.
- **Fas 9** – klar: alla inloggade roller kan rapportera problem direkt i
  appen (knappen "Rapportera problem" i menyraden, syns på alla sidor).
  Rapporten sparas alltid i `bug_reports` och synkas best-effort till ett
  issue i utvecklarens GitHub-repo (`GITHUB_ISSUES_TOKEN`/
  `GITHUB_ISSUES_REPO`, se `.env.example` och `DEPLOY-CPANEL.md`) — utan
  dessa miljövariabler sparas rapporten ändå lokalt, bara utan
  GitHub-synk. `TENANT_NAME` stämplas som label så flera kunders
  rapporter går att skilja åt i samma repo. Listan (`GET
  /api/bug-reports`, för att se synkstatus) kräver ADMIN.
- **Kvar**: riktig Fortnox-koppling (order → kundfaktura, synk tillbaka
  — stub finns i `fortnox.js`, väntar på testmiljö). Mindre luckor:
  auditlogg och GDPR-verktyg (export/radering av persondata) är inte
  byggt, koppla produkt↔leverantör saknar ännu ett UI-formulär (backend
  klart, `POST /api/products/:id/suppliers` finns). Se `PLAN.md` för
  detaljer.
