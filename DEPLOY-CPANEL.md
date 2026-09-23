# Publicera i cPanel (Node.js Selector, ingen SSH krävs)

Det här är den riktiga, återanvändbara publiceringsvägen — inte en
engångs-zip. Varje gång ni vill uppdatera den publicerade sidan gör ni om
steg 2 (hämta senaste koden) och steg 5 (`Run NPM Install`); resten står
kvar som det är.

`apps/api` är en helt fristående Node-app: den har inga interna
paketberoenden (inget npm-workspace behövs för att den ska fungera), och
ett `postinstall`-skript kör databasmigrering + seedning automatiskt varje
gång `npm install` körs. Det gör att den fungerar med **vilken npm-version
som helst** — viktigt eftersom vissa cPanel-värdars Node.js Selector
använder en äldre npm oavsett vilken Node.js-version man väljer i
listrutan (npm-workspaces kräver npm 7+, och om värden kör äldre npm
ignoreras det tyst utan felmeddelande — det var precis det som orsakade
"Cannot find package 'express'" tidigare).

## 1. Databas (cPanel → MySQL Databases)

- Skapa en databas (t.ex. `proarb` → blir `dittanvändarnamn_proarb`).
- Skapa en databasanvändare + lösenord.
- Lägg till användaren i databasen med **All Privileges**.
- Notera fullständigt databasnamn, användarnamn och lösenord — de
  behövs i steg 4.

## 2. Hämta koden till servern

**Alternativ A — cPanel Git™ Version Control (rekommenderas):**
- cPanel → *Git™ Version Control* → *Create*.
- Clone URL: `https://github.com/rasmus-arch/proarb` (eller er egen
  fork), branch enligt önskemål, valfri katalog (t.ex. `proarb`).
- Efter varje uppdatering ni vill publicera: samma sida → *Manage* →
  *Pull or Deploy* → *Update from Remote*.

**Alternativ B — File Manager (om Git-verktyget inte finns/går att
använda):**
- Ladda ner repot som zip (GitHub → Code → Download ZIP).
- Ladda upp zip:en i cPanel File Manager (utanför `public_html`) och
  packa upp den.
- Vid en uppdatering: ladda upp och packa upp en ny zip på samma
  ställe (skriv över).

## 3. Skapa Node.js-appen (cPanel → Setup Node.js App)

- *Create Application*.
- Node.js version: senaste tillgängliga (minst 18, gärna 20+).
- Application mode: Production (spelar ingen praktisk roll för appen,
  men undviker en förvirrande `NODE_ENV=development`).
- **Application root**: mappen från steg 2, **fram till och med
  `apps/api`** — t.ex. `proarb/apps/api` (INTE repots rot, och inte
  bara `proarb`).
- **Application URL**: den domän/subdomän appen ska svara på (skapa
  gärna en subdomän under cPanel → Subdomains först).
- **Application startup file**: `src/index.js`
- *Create*.

> Om ni redan har en app skapad med *Application root* satt till
> repots rot (fel), går det **inte** att bara ändra fältet till en
> undermapp (`.../apps/api`) — cPanels Node.js Selector kan inte flytta
> sin interna miljö till en katalog som ligger inuti den nuvarande och
> kraschar med `Cannot move a directory into itself`. Ta bort den
> gamla appen (*Destroy*, tar bara bort Node-registreringen, inte
> filerna) och skapa en ny med rätt *Application root* från början.

## 4. Miljövariabler

I samma vy, under *Environment Variables*, lägg till **alla fyra**:

| Variabel      | Värde                                    |
|---------------|-------------------------------------------|
| `DB_HOST`     | `localhost`                                |
| `DB_USER`     | fullständigt användarnamn från steg 1       |
| `DB_PASSWORD` | lösenordet från steg 1                     |
| `DB_NAME`     | fullständigt databasnamn från steg 1        |

Rör inte `PORT` — cPanel/Passenger sätter den automatiskt.

**Valfritt — demodata**: lägg även till `SEED_DEMO_DATA` = `true` om ni
vill ha exempel-kunder/offerter/order/tryckorder (för att visa flödet
kund → offert → order → tryckorder) automatiskt vid nästa seedning.
Använd **aldrig** detta på en riktig produktionsdatabas — lägg bara till
det i en ren demomiljö. Samma data finns även som en fristående fil,
`apps/api/db/demo-seed.sql`, som går att klistra in i phpMyAdmins
SQL-flik manuellt istället, oavsett miljövariabeln.

**Valfritt — buggrapportering till GitHub**: personalen hos kunden kan
rapportera problem direkt i appen (knappen "Rapportera problem" i
menyraden). Rapporterna sparas alltid i databasen, men för att de även ska
dyka upp som issues i det här GitHub-repot behöver ni fylla i **Repo** och
**Personal access token** under Inställningar → Buggrapporter (GitHub) i
appen — samma självbetjänings-princip som SMTP/Fortnox nedan, ingen
miljövariabel eller omdeploy krävs.

Skapa token på
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
välj *Only select repositories* → detta repo, och under *Repository
permissions* sätt **Issues: Read and write** (inget annat behövs). Utan
detta fungerar knappen fortfarande (rapporten sparas lokalt i
`bug_reports`-tabellen), den synkas bara inte till GitHub. (`TENANT_NAME`
är en separat, valfri miljövariabel — bara relevant om samma repo tar emot
rapporter från fler än en driftsättning; se `.env.example`.)

## 5. Installera + seeda databasen

Klicka **Run NPM Install**.

Det här gör två saker i ett steg:
1. Installerar alla beroenden (vanlig `npm install`, fungerar oavsett
   npm-version — appen har inga interna paketberoenden att lösa upp).
2. Kör automatiskt databasmigrering + grundseedning (lager, tryckmetoder,
   en admin-användare) via ett `postinstall`-skript.

Det är säkert att klicka på den här knappen igen senare — t.ex. efter
att ni hämtat ny kod i steg 2 — den skriver aldrig över befintlig data,
bara ser till att tabeller och grunddata finns.

**Verifiera innan ni går vidare:** öppna File Manager, gå till
`apps/api/node_modules` och kontrollera att det finns en mapp som heter
`express` där, och att `node_modules` innehåller ungefär 20-25
undermappar för express-, mysql2- och pdfkit-beroenden vardera (runt
100+ mappar totalt, inte bara en handfull). Om det är väldigt få mappar
gick installationen troligen sönder halvvägs — radera `node_modules`
och `package-lock.json` i `apps/api` och kör *Run NPM Install* igen.

## 6. Starta och testa

- Klicka *Restart*.
- Öppna er Application URL. Ni hamnar på en inloggningssida.
- Logga in med `admin@example.com` / `changeme`.
- Gå direkt till *Inställningar → Användare* och byt lösenordet (eller
  skapa ett nytt ADMIN-konto och inaktivera det gamla).

## Felsökning

- **"Cannot find package 'express'" i felloggen**: `node_modules` i
  `apps/api` saknar paket — se verifieringssteget i punkt 5. Vanligast
  orsak: *Run NPM Install* klickades aldrig, eller avbröts halvvägs.
- **500-fel / kan inte logga in**: kontrollera `DB_HOST`/`DB_USER`/
  `DB_PASSWORD`/`DB_NAME` i steg 4, och att *Run NPM Install* har körts
  minst en gång utan fel.
- **"Cannot find module '.../src/index.js'"**: *Application root*
  pekar på fel mapp — den ska sluta på `apps/api`, inte på repots rot.
- **Auto-seedningen (`postinstall`) verkar inte köras, eller loggen visar
  ett fel om `.../nodevenv/.../lib/...`**: vissa cPanel-värdars Node.js
  Selector (CloudLinux) kör `npm install` i en intern "venv"-katalog som
  skiljer sig från er riktiga kod, och installerar paketen dit istället
  för till `apps/api/node_modules`. `postinstall`-skriptet är byggt för
  att räkna ut den riktiga sökvägen i det fallet, men **auto-seedning kan
  ändå fallera på vissa sådana värdar** eftersom node_modules bokstavligen
  hamnar på annat ställe än koden. Det är ofarligt (`|| true` gör att det
  aldrig stoppar installationen) — seeda i så fall manuellt via
  phpMyAdmin (se nedan) istället, en gång per driftsättningsmiljö.
  Själva appen påverkas inte av detta (den startas av Passenger på ett
  annat sätt än `npm install` gör).
- **`Cannot move a directory into itself`**: se rutan i steg 3 — gäller
  när man försöker ändra *Application root* på en befintlig app till en
  undermapp av sig själv. Skapa en ny app istället.
- **Vill seeda om manuellt utan att röra Node-appen**: cPanel →
  phpMyAdmin, välj databasen, fliken *SQL*, klistra in och kör
  `apps/api/db/schema.sql` och sedan `apps/api/db/seed.sql`.
- Uppladdade loggor/tryckfiler (kundloggor m.m.) sparas i
  `apps/api/uploads/` på servern — mappen skapas automatiskt av appen
  själv första gången något laddas upp.
