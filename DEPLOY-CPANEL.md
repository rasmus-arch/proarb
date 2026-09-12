# Publicera i cPanel (Node.js Selector, ingen SSH krävs)

Det här är den riktiga, återanvändbara publiceringsvägen — inte en
engångs-zip. Varje gång ni vill uppdatera den publicerade sidan gör ni om
steg 2 (hämta senaste koden) och steg 5 (`Run NPM Install`); resten står
kvar som det är.

Repot är förberett för det här: `apps/api` beror på `packages/db` via ett
vanligt npm-workspace (inte pnpm-specifik syntax), och ett `postinstall`-
skript kör databasmigrering + seedning automatiskt varje gång `npm
install` körs — säkert att köra om när som helst (`CREATE TABLE IF NOT
EXISTS` / `INSERT IGNORE`, skriver aldrig över befintlig data).

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

Oavsett alternativ: mappen ska innehålla `apps/`, `packages/`,
`package.json`, `pnpm-workspace.yaml` osv direkt i sin rot.

## 3. Skapa Node.js-appen (cPanel → Setup Node.js App)

- *Create Application*.
- Node.js version: senaste tillgängliga (minst 18, gärna 20+).
- Application mode: Production.
- **Application root**: mappen från steg 2 (repots rot — INTE
  `apps/api`).
- **Application URL**: den domän/subdomän appen ska svara på (skapa
  gärna en subdomän under cPanel → Subdomains först).
- **Application startup file**: `apps/api/src/index.js`
- *Create*.

## 4. Miljövariabler

I samma vy, under *Environment Variables*, lägg till:

| Variabel      | Värde                                    |
|---------------|-------------------------------------------|
| `DB_HOST`     | `localhost`                                |
| `DB_USER`     | fullständigt användarnamn från steg 1       |
| `DB_PASSWORD` | lösenordet från steg 1                     |
| `DB_NAME`     | fullständigt databasnamn från steg 1        |

Rör inte `PORT` — cPanel/Passenger sätter den automatiskt.

Klicka *Save*.

## 5. Installera + seeda databasen

Klicka **Run NPM Install**.

Det här gör två saker i ett steg:
1. Installerar alla beroenden (vanlig `npm install`, ingen pnpm behövs
   på servern).
2. Kör automatiskt databasmigrering + grundseedning (lager, tryckmetoder,
   en admin-användare) via ett `postinstall`-skript.

Det är säkert att klicka på den här knappen igen senare — t.ex. efter
att ni hämtat ny kod i steg 2 — den skriver aldrig över befintlig data,
bara ser till att tabeller och grunddata finns.

Om installationsloggen visar en varning om att databasen inte gick att
seeda (t.ex. fel lösenord), rätta miljövariablerna i steg 4 och klicka
på knappen igen.

## 6. Starta och testa

- Klicka *Restart*.
- Öppna er Application URL. Ni hamnar på en inloggningssida.
- Logga in med `admin@example.com` / `changeme`.
- Gå direkt till *Inställningar → Användare* och byt lösenordet (eller
  skapa ett nytt ADMIN-konto och inaktivera det gamla).

## Felsökning

- **500-fel / kan inte logga in**: kontrollera `DB_HOST`/`DB_USER`/
  `DB_PASSWORD`/`DB_NAME` i steg 4, och att *Run NPM Install* har körts
  minst en gång utan fel.
- **"Cannot find module ..."**: *Application root* pekar troligen på
  fel mapp — den ska vara repots rot, inte `apps/api`.
- **Vill seeda om manuellt utan att röra Node-appen**: cPanel →
  phpMyAdmin, välj databasen, fliken *SQL*, klistra in och kör
  `packages/db/sql/schema.sql` och sedan `packages/db/sql/seed.sql`.
- Uppladdade loggor/tryckfiler (kundloggor m.m.) sparas i
  `apps/api/uploads/` på servern — mappen skapas automatiskt av appen
  själv första gången något laddas upp.
