# ProArb – affärssystem för profil-/arbetskläderbutik

Byggplan och kravspec för ett affärssystem liknande det som tidigare byggts
för Profil & Arbetskläder i Eskilstuna AB. Målgrupp: butik som säljer
arbetskläder och profilprodukter, ofta med tryck/brodyr, både i fysisk
butik och till företagskunder via offert/order.

## 1. Mål

Ett system som täcker hela flödet: **kund → offert → order → plock/tryck →
utlämning/leverans → fakturering**, plus en **kassa** för direktförsäljning
i butik och **lagerhantering** med streckkodsskanning, för en katalog på
100 000+ produktrader (kläder i många färger/storlekar).

## 2. Huvudmoduler (från kravet)

1. **Kundregister**
   - Kundkort med org.nr, kontaktuppgifter, betalvillkor, prislista.
   - Kundlogga (för tryck-underlag och offert-/orderdokument).
   - Lista över anställda hos kunden med **hämtbehörighet** (vem får hämta
     ut kläder i butik) – med valfri PIN-kod/legitimation vid utlämning.
2. **Offerter**
   - Skapas per kund, med valfri referensperson (kundens kontakt).
   - Rader kopplade till produktvarianter, pris, rabatt, ev. tryck/brodyr.
   - Kan skickas digitalt: **PDF** + **unik länk** kunden kan öppna och
     acceptera/avböja utan inloggning.
   - Omvandlas till order med ett klick, eller order skapas direkt utan
     offert.
3. **Order**
   - Skapas från offert eller direkt.
   - Status: ny → bekräftad → i produktion (tryck) → klar för avhämtning →
     levererad/delvis levererad → fakturerad.
   - Utlämning kräver vald hämtberättigad kontakt (eller manuellt namn +
     signatur som fallback).
4. **Kassa (POS)**
   - Skanna streckkod → lägg i kundvagn → betala (kort/kontant/Swish/
     mot faktura för företagskund).
   - Fungerar med vanliga USB/BT-handskannrar (agerar tangentbord, se
     teknisk lösning nedan) – ingen speciell hårdvaruintegration krävs.
   - Kvitto (PDF/utskrift), växelkassa (kassalåda-avstämning).
5. **Lagerhantering**
   - Skanna in vid mottagning (PO/inleverans), automatiska lagerrörelser
     vid försäljning/orderplock.
   - Flera lagerplatser (t.ex. Butik + Centrallager) med överföringar.
   - **Inköpsförslag**, egen flik, uppdelad på leverantör och per order:
     - Rader på en order som saknar täckning i lagersaldot dyker upp här
       automatiskt (kopplat till `ProductSupplier` för att veta rätt
       leverantör).
     - Per produkt går det att sätta ett minsta lagersaldo (`reorder_point`,
       finns redan i `StockLevel`) och en beställningskvantitet — går
       saldot under gränsen läggs ett förslag upp även utan en order bakom.
     - På en enskild orderrad går det att bocka för "ta inte från lager"
       (en `sourcing`-flagga per `OrderLine`, t.ex. `STOCK`/`PURCHASE`) så
       att raden alltid hamnar i inköpsförslaget och beställs särskilt för
       den ordern, oavsett aktuellt saldo.
   - **Inventering** (`StockCount`/`StockCountLine`), juridiskt hållbar:
     starta en inventering per lagerplats, skanna alla varor som finns
     fysiskt i butiken (eller lägg in antal manuellt för det som inte
     scannas). Systemet visar sedan en avvikelselista — artiklar som
     *borde* finnas enligt saldo men som inte blev skannade (och
     ev. skannade artiklar utöver förväntat saldo) — där man radvis eller
     för hela listan väljer att antingen justera bort dem ur lagersaldot
     eller lämna dem kvar. Varje beslut loggas som en `StockMovement`
     (typ `ADJUSTMENT`) med vem som gjorde justeringen och när, så
     inventeringen blir spårbar i efterhand.
6. **Produktkatalog (100 000+ rader, varianter)**
   - Produkt = grundmodell (artikel), Variant = färg × storlek med eget
     SKU + EAN/streckkod.
   - Kategori, varumärke, leverantör, kostpris/utpris, momssats.
   - Byggd för bulkimport (se §6) eftersom leverantörer inom
     arbetskläder/profil (New Wave, Fristads, Clique m.fl.) ofta
     tillhandahåller produktflöden (CSV/EDI/API).

## 3. Föreslagna tilläggsfunktioner

- **Tryckorder-spårning**: tryck/brodyr tar tid – egen delstatus per
  order-/offertrad (väntar → hos tryckeri → klar) så butiken vet vad som
  är redo att plockas.
- **Kundspecifika prislistor & mängdrabatter** – vanligt i profilbranschen
  (t.ex. -10 % vid 20+ st).
- **Kundportal**: kunden loggar in och ser orderhistorik, sina offerter,
  fakturor och kan beställa påfyllnad av samma profilkläder igen.
- **Påminnelser**: automatiskt e-postpåminnelse om obesvarad offert efter
  X dagar; offerten spårar öppnad/visad-status (`QuoteEvent`-logg).
- **Inställningar-flik**: admin-vy för att styra säljarinfo/logga/färger på
  offert-PDF:en och den publika offertsidan, samt på/av + intervall för
  e-postpåminnelser om obesvarade offerter. Själva utskicket kräver en
  SMTP-/e-postleverantör att koppla mot (t.ex. Postmark/SendGrid) – det
  konfigureras separat, inställningsfliken styr bara *om/hur*.
- **E-signering vid accept**: namn + tidsstämpel + IP sparas som enkelt
  juridiskt spår vid digital accept av offert.
- **Etikettutskrift**: skriv ut egna EAN/SKU-etiketter för produkter utan
  streckkod (t.ex. ompackade profilprodukter).
- **Fortnox-integration**: när en order är klar (levererad/redo att
  fakturera) skickas den till Fortnox via deras API och görs om till en
  kundfaktura där, i stället för att bygga en egen bokföringsmotor.
  `Invoice`-tabellen har `external_ref`/`status`-fält för att spegla
  Fortnox fakturanummer och status tillbaka i ProArb. (Alternativ:
  Visma/Björn Lundén om kunden hellre använder det.)
- **Retur/RMA-flöde** för både butik och företagsorder.
- **Statistik/dashboard**: bästsäljande produkter, bästsäljande
  **kategorier** och **bästa kunder** (per period, i antal och i kronor),
  offert-konverteringsgrad, lagervärde, försäljning per säljare/kassa.
  Bygger på `sale_lines`/`order_lines` (och `products.category_id`,
  `customers`) så listorna kan räknas fram direkt ur transaktionsdata.
- **Marginalberäkning**: eftersom varje produkt har både `cost_price`
  (inköpspris) och försäljningspris kan systemet räkna ut marginal (kr
  och %) per produkt, per offert/order och per kassarad – och därmed
  även bruttovinst per kund eller period i statistiken ovan.
- **Rollbaserad åtkomst**: kassapersonal ska t.ex. inte se inköpspriser;
  endast admin/inköp ser leverantörspriser och marginaler.
- **PWA för lager/mottagning**: mobilanpassad sida som använder
  telefonens kamera som streckkodsläsare vid inventering/mottagning, som
  komplement till handskannrar.
- **Auditlogg** på pris-/lagerändringar samt GDPR-radering/anonymisering
  av kundkontakter vid behov.

## 4. Datamodell (kärnentiteter)

Full modell finns i [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma).
Översikt:

```
Customer ──< CustomerContact (hämtbehörighet, referens på offert/order)
Customer ──< Quote ──< QuoteLine >── ProductVariant >── Product
Quote ──< QuoteEvent (skickad/visad/accepterad – för spårning)
Quote 1──1 Order ──< OrderLine
Order ──< OrderPickup (vem hämtade ut, kopplat till CustomerContact)
Order 1──1 Invoice (extern fakturareferens, t.ex. Fortnox)

Product ──< ProductVariant (färg × storlek, unikt SKU + streckkod)
Product >── Brand / ProductCategory
Product ──< ProductSupplier >── Supplier
PriceList ──< PriceListItem >── ProductVariant   (kundspecifika priser)

Warehouse ──< StockLevel >── ProductVariant       (saldo per lagerplats)
Warehouse ──< StockMovement                       (in/ut/justering/överföring)
Warehouse ──< StockCount ──< StockCountLine        (inventering via skanning)
Supplier ──< PurchaseOrder ──< PurchaseOrderLine   (inleverans via skanning)

PosSession ──< Sale ──< SaleLine >── ProductVariant
Sale ──< Payment (kontant/kort/Swish/faktura)
```

## 5. Teknisk arkitektur

Samma grundstack som föregångaren (Node.js + MariaDB), moderniserad:

- **Monorepo** (pnpm workspaces):
  - `apps/api` – Fastify + TypeScript REST-API, Zod för validering.
  - `apps/web` – React + TypeScript (Vite), React Router, TanStack Query.
  - `packages/db` – Prisma-schema + genererad klient, delas av API:t
    (och ev. bakgrundsjobb/importskript senare).
- **Databas**: MariaDB (via `docker-compose.yml` för lokal utveckling).
  Prisma används med `provider = "mysql"`, vilket fungerar mot MariaDB.
- **Autentisering**: sessions-/JWT-baserad inloggning, roller enligt
  `UserRole` (ADMIN, SALES, WAREHOUSE, POS).
- **PDF-generering**: Puppeteer (HTML/CSS → PDF) för offert/order/kvitto,
  så samma layoutkomponenter kan återanvändas i webbvyn och PDF:en.
- **Digital offertlänk**: `Quote.publicToken` (slumpad, ogissbar) exponerar
  en publik, skrivskyddad sida `/q/:token` med acceptera/avböj-knappar –
  ingen inloggning krävs för kunden.
- **Streckkodsskanning**: vanliga USB/Bluetooth-skannrar fungerar som
  tangentbord ("HID keyboard wedge") – kassan/lagervyn lyssnar på snabba
  knapptryckningar som avslutas med Enter. Ingen speciell drivrutin
  behövs. Kamerabaserad skanning (mobil/PWA) läggs till som komplement
  senare (t.ex. med ett bibliotek som `@zxing/browser`).
- **Bulkimport av produkter**: CSV/Excel-import samt plats för schemalagd
  import mot leverantörers produktflöden, kritiskt för att hantera
  100 000+ rader utan manuell inmatning.

### Katalogstruktur (skapad i detta repo)

```
proarb/
  apps/
    api/       Fastify-API
    web/       React-app (Vite)
  packages/
    db/        Prisma-schema + delad databasklient
  docker-compose.yml   MariaDB för lokal utveckling
  PLAN.md              detta dokument
```

## 6. Fasindelad utbyggnadsplan

| Fas | Status | Innehåll |
|---|---|---|
| 0 | ✅ Klar | Repo-scaffold, grundmoduler, kassa-skanning (uppslag) |
| 1 | ✅ Klar | Produktkatalog: CRUD, varianter, kategorier/varumärken, CSV-bulkimport |
| 2 | ✅ Klar | Offerter: skapa/skicka, PDF, publik länk, acceptera → konvertera till order |
| 3 | ✅ Klar | Order: direktskapande, statusflöde, utlämning mot behörig kontakt |
| 4 | ✅ Klar | Kassa: streckkodsskanning, delad betalning, PDF-kvitto, kassaavstämning |
| 5 | ✅ Klar | Lager: saldo per lagerplats, inleverans-skanning, **inventering** (skanna/manuellt, avvikelselista inkl. ej skannat, justera eller behåll, spårbart via `StockMovement`), lågt-lager-varningar, **inköpsförslag** per leverantör |
| 6 | ✅ Klar | Tryck/produktionsflöde kopplat till order-/offertrader |
| 7 | ✅ Klar | Kundportal (länk utan inloggning), påminnelser (skickas ej via e-post ännu — se nedan). Fortnox-integrationen (order → kundfaktura, retur → kreditfaktura, "Fakturerad" → skicka från Fortnox) är byggd mot Fortnox' riktiga API (OAuth2 + `/3/invoices`/`/3/customers`), se `fortnox.js` — anslut under Inställningar, oprövat mot en verklig Fortnox-miljö. |
| 8 | ✅ Klar* | Inloggning (e-post/lösenord, sessions-cookie) och rollbaserad behörighet (ADMIN/SALES/WAREHOUSE/POS) på alla API-rutter. *Auditlogg, GDPR-verktyg (export/radering) och prestandaoptimering för stora kataloger är inte byggt — se `README.md`. |

**Tillkommande önskemål** (inte bundna till en specifik fas ovan):
- ✅ Kundkort: flerfils-uppladdning av namngivna logga/tryckvarianter
  (eps, jpg, png, svg, pdf) via en ny kunddetaljsida (`kund-editor.html`).
- ✅ Inställningar-flik: säljarinfo/logga/accentfärg/fottext för offert-PDF
  och publik offertsida, samt på/av + intervall för e-postpåminnelser
  (själva utskicket kräver fortfarande en SMTP-leverantör, ej kopplad).
- ✅ Statistik: bästsäljande produkter/kategorier/kunder + marginal,
  slår ihop kassa- och orderförsäljning.
- ✅ Marginal syns nu i kassan, offert-editorn och order-editorn (per
  rad + totalsumma), baserat på produktens `cost_price`.
- ✅ Order → Utlämnad skapar automatiskt en kundfaktura i Fortnox,
  "Fakturerad" skickar den från Fortnox till kunden, och en retur skapar
  en kreditfaktura – se `invoices`-tabellen och `fortnox.js`. Anslutning
  sker under Inställningar (OAuth2, "Anslut till Fortnox"); riktiga
  kassa-/POS-betalmetoder (Faktura/Swish → kontantfaktura) finns
  förberedda i `fortnox.js` (`createCashInvoice`) men har ingen anropande
  kassamodul ännu.
- ✅ Inköpsförslag: egen flik i Lager, uppdelad på leverantör, med både
  orderrader som saknar lagertäckning (eller är markerade "beställ ändå"
  via `order_lines.sourcing`) och produkter under sitt min-saldo. Går att
  skapa en inköpsorder direkt från ett förslag.

## 7. Prisregel: allt hanteras exklusive moms

Alla priser som systemet räknar med internt – produktens `base_price`,
`cost_price`, rader på offert/order/kassa, prislistor – anges och lagras
**exklusive moms**. Momssatsen (`tax_rate_percent`, default 25 %) ligger
separat per produkt och läggs bara på när en summa ska visas för kunden
(offert-PDF, orderbekräftelse, kassakvitto, totalsumma i kassan). Detta
gör att marginalberäkning, statistik och rapporter alltid kan jämföras
rakt av utan att först behöva räkna bort moms, och matchar hur
bokföring/Fortnox-export förväntas fungera.

## 8. Icke-funktionella krav

- **Prestanda**: 100 000+ produktrader kräver indexering på SKU/EAN,
  paginerad/serverside-sökning i produktlistan, och undvikande av
  N+1-frågor i variant-listningar.
- **Säkerhet**: lösenordshashning (argon2/bcrypt), rollbaserad åtkomst,
  ogissbara offert-tokens, HTTPS.
- **GDPR**: kundkontakters personuppgifter (namn, hämtbehörighet) ska
  kunna raderas/anonymiseras på begäran.
- **Backup**: daglig backup av MariaDB, testad återställning.
