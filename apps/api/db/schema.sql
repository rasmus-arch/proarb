-- ProArb database schema (MySQL / mysql2, no ORM).
-- Run with: mysql -u root -p proarb < schema.sql
-- (or via `pnpm db:migrate`, see packages/db/src/migrate.js)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('ADMIN', 'SALES', 'WAREHOUSE', 'POS') NOT NULL DEFAULT 'SALES',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fas 8: server-side sessions behind an HttpOnly cookie (token). Revocable
-- (delete the row = logout everywhere), unlike a stateless JWT — matches
-- the "no ORM, raw SQL" stack without pulling in a JWT library.
CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(64) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Settings (single row, id = 1)
-- ---------------------------------------------------------------------------

-- Controls how the seller appears on offert-PDF:er and the public offert-
-- sida, whether/how unanswered-quote reminder emails go out, and holds
-- the SMTP/Fortnox credentials for the integrations/email.js and
-- integrations/fortnox.js stubs — filled in here (Inställningar) whenever
-- a real provider/Fortnox app is ready; both stubs treat those columns
-- being empty as "not configured yet" and only start actually sending
-- once dispatch()/the Fortnox calls are implemented for real.
CREATE TABLE IF NOT EXISTS app_settings (
  id                    INT PRIMARY KEY DEFAULT 1,
  seller_name           VARCHAR(255) NOT NULL DEFAULT 'Mitt företag',
  seller_org_number     VARCHAR(50) NULL,
  seller_address        VARCHAR(255) NULL,
  seller_postal_code    VARCHAR(20) NULL,
  seller_city           VARCHAR(120) NULL,
  seller_email          VARCHAR(255) NULL,
  seller_phone          VARCHAR(50) NULL,
  seller_logo_path      VARCHAR(500) NULL,
  brand_color           VARCHAR(7) NOT NULL DEFAULT '#0f172a',
  quote_footer_note     VARCHAR(1000) NULL,
  reminder_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  reminder_days_after   INT NOT NULL DEFAULT 5,
  -- Av som standard: lagersaldot är bara pålitligt att visa för kunder
  -- efter en fullständig inventering. Slå på i Inställningar när ni är
  -- klara med den.
  portal_show_stock     TINYINT(1) NOT NULL DEFAULT 0,
  inactive_customer_months INT NOT NULL DEFAULT 6,
  -- Öppnar ordersedelns PDF och triggar webbläsarens utskriftsdialog
  -- automatiskt när en ny order sparas. Kräver ändå att någon klickar
  -- "Skriv ut" i dialogen om inte den datorns webbläsare är konfigurerad
  -- för tyst utskrift (t.ex. Chrome --kiosk-printing) — appen kan inte
  -- tvinga fram helt knapptryckningsfri utskrift på egen hand.
  auto_print_order_slip TINYINT(1) NOT NULL DEFAULT 0,
  -- Sekventiella offert-/ordernummer (0001, 0002, ...) istället för
  -- slumpmässiga tidsstämplar. Fältet lagrar NÄSTA nummer att använda —
  -- ändringsbart i Inställningar om numreringen behöver startas om eller
  -- hoppa till ett visst värde (t.ex. vid byte från ett annat system).
  next_order_number     INT NOT NULL DEFAULT 1,
  next_quote_number      INT NOT NULL DEFAULT 1,
  smtp_host             VARCHAR(255) NULL,
  smtp_port             INT NULL,
  smtp_username         VARCHAR(255) NULL,
  smtp_password         VARCHAR(255) NULL,
  smtp_from_email       VARCHAR(255) NULL,
  smtp_use_tls          TINYINT(1) NOT NULL DEFAULT 1,
  fortnox_client_id     VARCHAR(255) NULL,
  fortnox_client_secret VARCHAR(255) NULL,
  fortnox_access_token  VARCHAR(500) NULL,
  fortnox_refresh_token VARCHAR(500) NULL,
  -- Satt av integrations/fortnox.js: när access_token går ut (för att veta
  -- när den ska förnyas via refresh_token) och den tillfälliga "state"-
  -- parametern för den pågående OAuth-inloggningen (skyddar mot CSRF på
  -- callback-anropet, nollställs direkt efter). fortnox_cash_customer_number
  -- cachar Fortnox-kundnumret för den generiska "Kontantkund" som
  -- kontantfakturor (createCashInvoice) bokförs mot.
  fortnox_token_expires_at   DATETIME NULL,
  fortnox_oauth_state        VARCHAR(64) NULL,
  fortnox_cash_customer_number VARCHAR(20) NULL,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_app_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO app_settings (id) VALUES (1);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_lists (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  name             VARCHAR(255) NOT NULL,
  discount_percent DECIMAL(5,2) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  customer_number    VARCHAR(50) NOT NULL UNIQUE,
  name               VARCHAR(255) NOT NULL,
  org_number         VARCHAR(50) NULL,
  email              VARCHAR(255) NULL,
  -- Fakturerings-epost: dit fakturor/påminnelser om betalning ska gå, om
  -- det skiljer sig från kontaktpersonens vanliga e-post (email ovan) —
  -- vanligt hos företag som har en gemensam ekonomi-/fakturabrevlåda.
  -- Faller tillbaka på email när den saknas (se customers/service.js).
  invoice_email      VARCHAR(255) NULL,
  -- Fortnox-kundnumret motsvarande denna kund, satt av
  -- integrations/fortnox.js första gången en faktura skickas för kunden
  -- (skapar kunden i Fortnox om den saknar ett). Cachas här så kunden
  -- inte skapas dubbelt i Fortnox nästa gång.
  fortnox_customer_number VARCHAR(20) NULL,
  phone              VARCHAR(50) NULL,
  address            VARCHAR(255) NULL,
  postal_code        VARCHAR(20) NULL,
  city               VARCHAR(120) NULL,
  country            VARCHAR(2) NOT NULL DEFAULT 'SE',
  logo_url           VARCHAR(500) NULL,
  price_list_id      INT NULL,
  payment_terms_days INT NOT NULL DEFAULT 30,
  notes              TEXT NULL,
  active             TINYINT(1) NOT NULL DEFAULT 1,
  -- Fas 7 kundportal: unguessable token for a no-login, read-only page
  -- (/portal/:token) listing the customer's own offerter/ordrar. Generated
  -- on demand by staff, same pattern as quotes.public_token.
  portal_token       VARCHAR(64) NULL UNIQUE,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_customers_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
  INDEX idx_customers_price_list (price_list_id),
  INDEX idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Employees of the customer: used as a reference on quotes/orders, and
-- (when can_pickup = 1) as someone authorized to pick up clothes in-store.
CREATE TABLE IF NOT EXISTS customer_contacts (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  email       VARCHAR(255) NULL,
  phone       VARCHAR(50) NULL,
  role        VARCHAR(120) NULL,
  can_pickup  TINYINT(1) NOT NULL DEFAULT 0,
  pickup_code VARCHAR(50) NULL,
  notes       VARCHAR(500) NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_contacts_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_contacts_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Named logo/print-artwork variants for a customer (e.g. "Vit logga",
-- "Broderifil"). Several files per customer, each with its own name so
-- staff can pick the right one when building a quote/order print line.
CREATE TABLE IF NOT EXISTS customer_logos (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  customer_id       INT NOT NULL,
  name              VARCHAR(255) NOT NULL,
  file_path         VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type         VARCHAR(100) NOT NULL,
  file_size         INT NOT NULL,
  uploaded_by       INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_logos_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_customer_logos_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_customer_logos_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Products & variants (color x size). Catalog scale: 100k+ rows.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_categories (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  name      VARCHAR(255) NOT NULL,
  parent_id INT NULL,
  CONSTRAINT fk_category_parent FOREIGN KEY (parent_id) REFERENCES product_categories(id),
  INDEX idx_category_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brands (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id    INT PRIMARY KEY AUTO_INCREMENT,
  name  VARCHAR(255) NOT NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(50) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE: base_price / cost_price (here and on all order/quote/sale lines
-- and price_list_items) are always EXCLUDING VAT ("ex moms"). tax_rate_percent
-- is applied only when rendering a total for the customer (PDF/receipt/checkout).
CREATE TABLE IF NOT EXISTS products (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  article_number   VARCHAR(100) NOT NULL UNIQUE,
  name             VARCHAR(255) NOT NULL,
  description      TEXT NULL,
  category_id      INT NULL,
  brand_id         INT NULL,
  -- Den leverantör produkten köps in från. Krävs numera i formulären (även
  -- vid snabbskapande i offert/order) eftersom stående leverantörsrabatter
  -- (customer_discounts) matchar på den här kolumnen — men kolumnen är
  -- NULL-bar i databasen så en uppgraderad, redan i drift, installation med
  -- äldre produkter inte går sönder; de saknar bara leverantörsrabatt tills
  -- någon redigerar in en leverantör på dem.
  supplier_id      INT NULL,
  printable        TINYINT(1) NOT NULL DEFAULT 0,
  unit             VARCHAR(20) NOT NULL DEFAULT 'st',
  tax_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 25.00,
  base_price       DECIMAL(10,2) NOT NULL,
  cost_price       DECIMAL(10,2) NULL,
  image_url        VARCHAR(500) NULL,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories(id),
  CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands(id),
  CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  INDEX idx_products_category (category_id),
  INDEX idx_products_brand (brand_id),
  INDEX idx_products_supplier (supplier_id),
  FULLTEXT INDEX ft_products_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per sellable color/size combination. sku / barcode (EAN) are what
-- the scanner reads in the POS and warehouse flows.
CREATE TABLE IF NOT EXISTS product_variants (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  product_id     INT NOT NULL,
  sku            VARCHAR(100) NOT NULL UNIQUE,
  barcode        VARCHAR(100) NULL UNIQUE,
  color          VARCHAR(80) NULL,
  size           VARCHAR(30) NULL,
  price_override DECIMAL(10,2) NULL,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_variants_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stående kundrabatt i procent, antingen på en hel leverantör eller på en
-- enskild produkt (aldrig båda på samma rad — det väljs i formuläret, se
-- customers/discounts-service.js). En produktregel slår en leverantörsregel
-- för samma kund om båda skulle matcha samma rad i en offert/order/kassa.
CREATE TABLE IF NOT EXISTS customer_discounts (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  customer_id       INT NOT NULL,
  supplier_id       INT NULL,
  product_id        INT NULL,
  discount_percent  DECIMAL(5,2) NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_discounts_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cust_discounts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_cust_discounts_product FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_cust_discounts_customer (customer_id),
  INDEX idx_cust_discounts_supplier (customer_id, supplier_id),
  INDEX idx_cust_discounts_product (customer_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- "Mina sidor" (kundportalen, /portal/:token) visar numera ett utvalt
-- sortiment istället för offert-/orderhistorik — det sortimentet är den
-- här tabellen: vilka produkter en viss kund får se på sin portalsida.
CREATE TABLE IF NOT EXISTS customer_assortment (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  product_id  INT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_assortment_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cust_assortment_product FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE KEY uq_cust_assortment (customer_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- En kunds anställda, för att hålla koll på vilka storlekar var och en
-- behöver — skiljer sig från customer_contacts (referens-/hämtpersoner,
-- ofta bara ett fåtal) genom att vara en fullständig personalförteckning
-- kopplad till uniformsstorlekar, ofta betydligt fler personer.
CREATE TABLE IF NOT EXISTS customer_employees (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  notes       VARCHAR(500) NULL,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_employees_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_cust_employees_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- En storlek (+ ev. färg) per produkt för en given anställd. Fritext på
-- storlek/färg istället för en låst product_variant_id, så en sparad
-- storlek överlever även om varianten senare tas bort/ändras ur
-- sortimentet — vid orderläggning matchas den mot en aktiv variant just
-- då (se orders/service.js resolveEmployeeSizeLines).
CREATE TABLE IF NOT EXISTS customer_employee_sizes (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  product_id  INT NOT NULL,
  size        VARCHAR(30) NULL,
  color       VARCHAR(80) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cust_emp_sizes_employee FOREIGN KEY (employee_id) REFERENCES customer_employees(id),
  CONSTRAINT fk_cust_emp_sizes_product FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE KEY uq_cust_emp_sizes (employee_id, product_id),
  INDEX idx_cust_emp_sizes_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Self-service beställning från "Mina sidor" (kundportalen): kunden väljer
-- antal ur sitt sortiment och skickar in. Blir INTE automatiskt en riktig
-- order (portal_token är obevakad/oautentiserad, och orders.created_by är
-- NOT NULL — kräver en inloggad användare) — en säljare granskar och
-- konverterar den till en riktig order via /api/customers/portal-requests/
-- :id/convert, som då blir den som "skapade" ordern i vanlig mening.
CREATE TABLE IF NOT EXISTS portal_order_requests (
  id                    INT PRIMARY KEY AUTO_INCREMENT,
  customer_id           INT NOT NULL,
  requested_by_name     VARCHAR(255) NULL,
  -- Vem kunden anger ska hämta ut beställningen — samma kontakt hamnar som
  -- referensperson på den riktiga ordern när en säljare konverterar
  -- förfrågan, så den redan finns med i pickup-listan när ordern väl är
  -- redo att hämtas ut.
  reference_contact_id  INT NULL,
  status                ENUM('NEW', 'CONVERTED', 'DISMISSED') NOT NULL DEFAULT 'NEW',
  order_id              INT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  handled_at            DATETIME NULL,
  handled_by            INT NULL,
  CONSTRAINT fk_por_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_por_contact FOREIGN KEY (reference_contact_id) REFERENCES customer_contacts(id),
  CONSTRAINT fk_por_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_por_user FOREIGN KEY (handled_by) REFERENCES users(id),
  INDEX idx_por_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pris/rabatt fryst vid inskick (samma som kunden såg i portalen) — ändras
-- inte om en standardrabatt justeras innan säljaren hinner konvertera.
CREATE TABLE IF NOT EXISTS portal_order_request_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  request_id         INT NOT NULL,
  product_variant_id INT NOT NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  unit_price         DECIMAL(10,2) NOT NULL,
  discount_percent   DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent   DECIMAL(5,2) NOT NULL DEFAULT 25,
  CONSTRAINT fk_porl_request FOREIGN KEY (request_id) REFERENCES portal_order_requests(id),
  CONSTRAINT fk_porl_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_suppliers (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  product_id     INT NOT NULL,
  supplier_id    INT NOT NULL,
  supplier_sku   VARCHAR(100) NULL,
  cost_price     DECIMAL(10,2) NULL,
  lead_time_days INT NULL,
  CONSTRAINT fk_psup_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_psup_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  UNIQUE KEY uq_product_supplier (product_id, supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Produktpaket ("Kit"): en generisk, återanvändbar kombination av
-- produkter (t.ex. "Nyanställd-kit") — till skillnad från order_templates
-- (som är en sparad kopia av en SPECIFIK kunds tidigare order) hör ett
-- paket inte till någon kund alls. "Lägg till paket" i en offert/order
-- expanderar det bara till vanliga, redigerbara rader — paketet i sig
-- lagras aldrig som en rad.
CREATE TABLE IF NOT EXISTS product_kits (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_kit_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  kit_id             INT NOT NULL,
  product_variant_id INT NOT NULL,
  quantity           DECIMAL(10,2) NOT NULL DEFAULT 1,
  sort_order         INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_pkl_kit FOREIGN KEY (kit_id) REFERENCES product_kits(id),
  CONSTRAINT fk_pkl_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  INDEX idx_pkl_kit (kit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Customer-specific pricing (negotiated prices).
CREATE TABLE IF NOT EXISTS price_list_items (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  price_list_id      INT NOT NULL,
  product_variant_id INT NOT NULL,
  price              DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_pli_price_list FOREIGN KEY (price_list_id) REFERENCES price_lists(id),
  CONSTRAINT fk_pli_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  UNIQUE KEY uq_price_list_variant (price_list_id, product_variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- e.g. Screentryck, Brodyr, Transfer, DTF
CREATE TABLE IF NOT EXISTS print_methods (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Quotes (offerter)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS quotes (
  id                   INT PRIMARY KEY AUTO_INCREMENT,
  quote_number         VARCHAR(50) NOT NULL UNIQUE,
  customer_id          INT NOT NULL,
  reference_contact_id INT NULL,
  status               ENUM('DRAFT','SENT','VIEWED','ACCEPTED','DECLINED','EXPIRED','CONVERTED') NOT NULL DEFAULT 'DRAFT',
  valid_until          DATE NULL,
  public_token         VARCHAR(64) NOT NULL UNIQUE,
  notes                TEXT NULL,
  created_by           INT NOT NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at              DATETIME NULL,
  viewed_at            DATETIME NULL,
  responded_at         DATETIME NULL,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_quotes_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_quotes_contact FOREIGN KEY (reference_contact_id) REFERENCES customer_contacts(id),
  CONSTRAINT fk_quotes_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_quotes_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  quote_id           INT NOT NULL,
  -- NULL for a fritextrad (free-text line) — description then carries the
  -- text instead of a real product name, and tax_rate_percent is used
  -- as-is instead of being read off a product.
  product_variant_id INT NULL,
  description        VARCHAR(255) NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  unit_price         DECIMAL(10,2) NOT NULL,
  discount_percent   DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent   DECIMAL(5,2) NULL,
  print_method_id    INT NULL,
  -- Tryck är valfritt per rad: fylls print_description i räknas
  -- print_price/print_discount_percent (antalet följer alltid radens
  -- egen quantity — inget eget tryckantal).
  print_description  VARCHAR(255) NULL,
  print_price        DECIMAL(10,2) NULL,
  print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order         INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_ql_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
  CONSTRAINT fk_ql_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_ql_print_method FOREIGN KEY (print_method_id) REFERENCES print_methods(id),
  INDEX idx_ql_quote (quote_id),
  INDEX idx_ql_variant (product_variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracking log for the digital quote link: sent / viewed / accepted / ...
CREATE TABLE IF NOT EXISTS quote_events (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  quote_id   INT NOT NULL,
  type       VARCHAR(50) NOT NULL,
  meta       VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qe_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
  INDEX idx_qe_quote (quote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id                   INT PRIMARY KEY AUTO_INCREMENT,
  order_number         VARCHAR(50) NOT NULL UNIQUE,
  customer_id          INT NOT NULL,
  reference_contact_id INT NULL,
  quote_id             INT NULL UNIQUE,
  -- Flödet är Order (NEW) -> Redo för utlämning -> Utlämnad -> Fakturerad,
  -- plus Avbruten. Tryck är bara ett valfritt textfält + pris/rabatt per
  -- rad (se order_lines) — ingen egen produktionsstatus/kö längre.
  status               ENUM('NEW','READY_FOR_PICKUP','DELIVERED','INVOICED','CANCELLED') NOT NULL DEFAULT 'NEW',
  delivery_method      ENUM('PICKUP','SHIPPING') NOT NULL DEFAULT 'PICKUP',
  created_by           INT NOT NULL,
  notes                TEXT NULL,
  -- QR-koden på ordersedelns PDF (se orders/pdf.js). Unguessable token,
  -- samma mönster som customers.portal_token — scanning den (ingen
  -- inloggning) kan bara flytta ordern NEW -> READY_FOR_PICKUP, aldrig
  -- något annat. Slutar fungera (redirect till proarb.se) så fort ordern
  -- lämnat NEW, oavsett om det skedde via scan eller manuellt i appen.
  pickup_qr_token      VARCHAR(64) NULL UNIQUE,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_orders_contact FOREIGN KEY (reference_contact_id) REFERENCES customer_contacts(id),
  CONSTRAINT fk_orders_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
  CONSTRAINT fk_orders_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_orders_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  order_id           INT NOT NULL,
  -- NULL for a fritextrad (free-text line) — description then carries the
  -- text instead of a real product name, and tax_rate_percent is used
  -- as-is instead of being read off a product.
  product_variant_id INT NULL,
  description        VARCHAR(255) NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  delivered_qty      DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_price         DECIMAL(10,2) NOT NULL,
  discount_percent   DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent   DECIMAL(5,2) NULL,
  print_method_id    INT NULL,
  -- Tryck är valfritt per rad: fylls print_description i räknas
  -- print_price/print_discount_percent (antalet följer alltid radens
  -- egen quantity — inget eget tryckantal). print_status var en separat
  -- produktionskö (Fas 6) — borttagen, kolumnen lämnas kvar oanvänd
  -- (samma "läs/skriv aldrig igen" som print_method_id) hellre än att
  -- DROP:a en kolumn på en databas som redan är i drift.
  print_description  VARCHAR(255) NULL,
  print_price        DECIMAL(10,2) NULL,
  print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order         INT NOT NULL DEFAULT 0,
  -- STOCK (default): fine to fulfil from current lagersaldo. PURCHASE:
  -- always order this in specifically for this order, even if there's
  -- stock on hand — always shows up in inköpsförslag (Fas 5).
  sourcing           ENUM('STOCK', 'PURCHASE') NOT NULL DEFAULT 'STOCK',
  print_status       ENUM('WAITING', 'IN_PRODUCTION', 'READY') NOT NULL DEFAULT 'WAITING',
  CONSTRAINT fk_ol_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_ol_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_ol_print_method FOREIGN KEY (print_method_id) REFERENCES print_methods(id),
  INDEX idx_ol_order (order_id),
  INDEX idx_ol_variant (product_variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who picked up an order in-store; ties back to an authorized
-- customer_contacts row when possible (walk-in fallback: picked_up_by_name).
CREATE TABLE IF NOT EXISTS order_pickups (
  id                     INT PRIMARY KEY AUTO_INCREMENT,
  order_id               INT NOT NULL,
  picked_up_by_contact_id INT NULL,
  picked_up_by_name      VARCHAR(255) NULL,
  picked_up_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_by_user_id    INT NULL,
  CONSTRAINT fk_op_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_op_contact FOREIGN KEY (picked_up_by_contact_id) REFERENCES customer_contacts(id),
  CONSTRAINT fk_op_user FOREIGN KEY (verified_by_user_id) REFERENCES users(id),
  INDEX idx_op_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS warehouses (
  id   INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_levels (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  product_variant_id INT NOT NULL,
  warehouse_id       INT NOT NULL,
  quantity_on_hand   DECIMAL(10,2) NOT NULL DEFAULT 0,
  reserved_qty       DECIMAL(10,2) NOT NULL DEFAULT 0,
  reorder_point      DECIMAL(10,2) NULL,
  -- how many to order when quantity_on_hand drops below reorder_point.
  reorder_quantity   DECIMAL(10,2) NULL,
  CONSTRAINT fk_sl_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_sl_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  UNIQUE KEY uq_variant_warehouse (product_variant_id, warehouse_id),
  -- The unique key above leads with product_variant_id, so a warehouse-only
  -- lookup (e.g. stocktake's "missing items" scan) can't use it as an index
  -- and falls back to a full table scan without this.
  INDEX idx_sl_warehouse (warehouse_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only ledger of every stock change, always traceable back to what
-- caused it (reference_type/reference_id, e.g. 'sale'/123 or 'purchase_order'/7).
CREATE TABLE IF NOT EXISTS stock_movements (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  product_variant_id INT NOT NULL,
  warehouse_id       INT NOT NULL,
  type               ENUM('PURCHASE_IN','SALE_OUT','ADJUSTMENT','TRANSFER','RETURN','RESERVATION') NOT NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  reference_type     VARCHAR(50) NULL,
  reference_id       INT NULL,
  note               VARCHAR(255) NULL,
  created_by         INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sm_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_sm_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sm_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sm_variant (product_variant_id),
  INDEX idx_sm_warehouse (warehouse_id),
  INDEX idx_sm_reference (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- status: ORDERED (default — created and placed, nothing app-side needs a
-- separate "send" step) -> PARTIALLY_RECEIVED / RECEIVED, set from the
-- line statuses below by receiveByBarcode/submitReceiving. VARCHAR (not
-- ENUM) so old DRAFT rows from before this comment still display fine.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  supplier_id   INT NOT NULL,
  status        VARCHAR(30) NOT NULL DEFAULT 'ORDERED',
  expected_date DATE NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Received via barcode scanning (receiveByBarcode) or the line-by-line
-- review form (submitReceiving) against expected quantity. line_status
-- lets staff explicitly resolve a line that wasn't fully received instead
-- of it silently sitting open forever: BACKORDERED (still expected later)
-- or CLOSED (the remainder was cancelled — quantity is lowered to match
-- what actually arrived).
CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  purchase_order_id  INT NOT NULL,
  product_variant_id INT NOT NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  received_qty       DECIMAL(10,2) NOT NULL DEFAULT 0,
  line_status        ENUM('OPEN','BACKORDERED','CLOSED') NOT NULL DEFAULT 'OPEN',
  cost_price         DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_pol_po FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  CONSTRAINT fk_pol_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  INDEX idx_pol_po (purchase_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_counts (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  warehouse_id INT NOT NULL,
  started_by   INT NULL,
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  status       VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
  CONSTRAINT fk_sc_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  CONSTRAINT fk_sc_user FOREIGN KEY (started_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per scanned (or manually added) variant during a stocktake
-- (inventering). decision/decided_by/decided_at give the audit trail the
-- user asked for: who chose to adjust lagersaldo vs. leave it, and when.
CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  stock_count_id     INT NOT NULL,
  product_variant_id INT NOT NULL,
  counted_qty        DECIMAL(10,2) NOT NULL,
  expected_qty       DECIMAL(10,2) NOT NULL,
  decision           ENUM('PENDING', 'ADJUST', 'KEEP') NOT NULL DEFAULT 'PENDING',
  decided_by         INT NULL,
  decided_at         DATETIME NULL,
  CONSTRAINT fk_scl_count FOREIGN KEY (stock_count_id) REFERENCES stock_counts(id),
  CONSTRAINT fk_scl_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  CONSTRAINT fk_scl_user FOREIGN KEY (decided_by) REFERENCES users(id),
  UNIQUE KEY uq_count_variant (stock_count_id, product_variant_id),
  INDEX idx_scl_count (stock_count_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Point of sale (kassa) — REMOVED as a feature (streckkodsläsning flyttades
-- till order-editor istället). Tables kept, unused, for historical sales
-- data and because `invoices` still references sale_id alongside order_id
-- (never DROP a table with real transaction history on a live database).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos_sessions (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  name           VARCHAR(120) NOT NULL,
  opened_by      INT NULL,
  opened_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at      DATETIME NULL,
  opening_float  DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_float  DECIMAL(10,2) NULL,
  CONSTRAINT fk_pos_user FOREIGN KEY (opened_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  sale_number  VARCHAR(50) NOT NULL UNIQUE,
  session_id   INT NULL,
  customer_id  INT NULL,
  cashier_id   INT NOT NULL,
  status       ENUM('COMPLETED','REFUNDED','PARTIAL_REFUND') NOT NULL DEFAULT 'COMPLETED',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_session FOREIGN KEY (session_id) REFERENCES pos_sessions(id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sales_cashier FOREIGN KEY (cashier_id) REFERENCES users(id),
  INDEX idx_sales_customer (customer_id),
  INDEX idx_sales_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_lines (
  id                 INT PRIMARY KEY AUTO_INCREMENT,
  sale_id            INT NOT NULL,
  -- NULL for a fritextrad (free-text line) — description then carries the
  -- text instead of a real product name, and tax_rate_percent is used
  -- as-is instead of being read off a product.
  product_variant_id INT NULL,
  description        VARCHAR(255) NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  unit_price         DECIMAL(10,2) NOT NULL,
  discount_percent   DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent   DECIMAL(5,2) NULL,
  CONSTRAINT fk_sale_lines_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  CONSTRAINT fk_sale_lines_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  INDEX idx_sale_lines_sale (sale_id),
  INDEX idx_sale_lines_variant (product_variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id        INT PRIMARY KEY AUTO_INCREMENT,
  sale_id   INT NOT NULL,
  method    ENUM('CASH','CARD','SWISH','INVOICE') NOT NULL,
  amount    DECIMAL(10,2) NOT NULL,
  reference VARCHAR(120) NULL,
  CONSTRAINT fk_payments_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  INDEX idx_payments_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Deliberately thin: real invoicing/bookkeeping is expected to happen in an
-- external system (Fortnox); this just tracks what needs to be pushed there
-- and the resulting status. Linked to either an order (fakturerad order) or
-- a POS sale paid by invoice/Swish (customer invoice / "kontantfaktura") —
-- not unique per order/sale since a split-payment sale can need more than
-- one (e.g. part Swish, part invoice). Defined here (after orders AND
-- sales both exist) rather than next to orders, since real MySQL — unlike
-- MariaDB — refuses to CREATE TABLE a foreign key against a table that
-- doesn't exist yet even with FOREIGN_KEY_CHECKS=0.
-- status here is the Fortnox sync status: PENDING / SYNCED / FAILED.
CREATE TABLE IF NOT EXISTS invoices (
  id             INT PRIMARY KEY AUTO_INCREMENT,
  order_id       INT NULL,
  sale_id        INT NULL,
  type           ENUM('CUSTOMER_INVOICE', 'CASH_INVOICE', 'CREDIT_INVOICE') NOT NULL DEFAULT 'CUSTOMER_INVOICE',
  invoice_number VARCHAR(50) NULL,
  external_ref   VARCHAR(100) NULL,
  status         VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  status_note    VARCHAR(255) NULL,
  amount         DECIMAL(10,2) NOT NULL,
  due_date       DATE NULL,
  sent_at        DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_invoices_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
  INDEX idx_invoices_order (order_id),
  INDEX idx_invoices_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Retur (hel eller delvis) av en redan utlämnad/fakturerad order. Fryser
-- pris/rabatt från order_lines vid returtillfället (samma princip som
-- portal_order_request_lines) — en senare prisändring på produkten ska
-- aldrig ändra vad som redan krediterats. Varje retur skapar en
-- CREDIT_INVOICE-rad i invoices (se orders/returns.js).
CREATE TABLE IF NOT EXISTS order_returns (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  order_id   INT NOT NULL,
  reason     VARCHAR(500) NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_or_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_or_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_or_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_return_lines (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  return_id        INT NOT NULL,
  order_line_id    INT NOT NULL,
  quantity         DECIMAL(10,2) NOT NULL,
  unit_price       DECIMAL(10,2) NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 25,
  print_price            DECIMAL(10,2) NULL,
  print_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_orl_return FOREIGN KEY (return_id) REFERENCES order_returns(id),
  CONSTRAINT fk_orl_line FOREIGN KEY (order_line_id) REFERENCES order_lines(id),
  INDEX idx_orl_return (return_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sparad radmall per kund ("Program") — inte en kopia av en specifik
-- tidigare order utan en namngiven, återanvändbar uppsättning rader man
-- kan skapa en ny order från när som helst (t.ex. "Vinteruniform 2026").
CREATE TABLE IF NOT EXISTS order_templates (
  id          INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  created_by  INT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ot_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ot_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_ot_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_template_lines (
  id                      INT PRIMARY KEY AUTO_INCREMENT,
  template_id             INT NOT NULL,
  product_variant_id      INT NULL,
  description             VARCHAR(255) NULL,
  quantity                DECIMAL(10,2) NOT NULL,
  unit_price              DECIMAL(10,2) NOT NULL,
  discount_percent        DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_rate_percent        DECIMAL(5,2) NULL,
  print_description       VARCHAR(255) NULL,
  print_price             DECIMAL(10,2) NULL,
  print_discount_percent  DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order              INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_otl_template FOREIGN KEY (template_id) REFERENCES order_templates(id),
  CONSTRAINT fk_otl_variant FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
  INDEX idx_otl_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fas 9: kunder som köpt systemet kan rapportera buggar/problem direkt i
-- appen. Sparas alltid lokalt (så historiken finns kvar även om
-- GitHub-synken misslyckas eller inte är konfigurerad än), och synkas
-- best-effort till ett issue i utvecklarens GitHub-repo — se
-- bug-reports/github.js, samma mönster som Fortnox-integrationen.
CREATE TABLE IF NOT EXISTS bug_reports (
  id                  INT PRIMARY KEY AUTO_INCREMENT,
  reported_by         INT NOT NULL,
  title               VARCHAR(255) NOT NULL,
  description         TEXT NOT NULL,
  severity            ENUM('LOW','MEDIUM','HIGH') NOT NULL DEFAULT 'MEDIUM',
  page_url            VARCHAR(500) NULL,
  user_agent          VARCHAR(255) NULL,
  github_issue_number INT NULL,
  github_issue_url    VARCHAR(255) NULL,
  github_sync_status  ENUM('PENDING','SYNCED','FAILED','NOT_CONFIGURED') NOT NULL DEFAULT 'PENDING',
  github_sync_note    VARCHAR(255) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bug_reports_user FOREIGN KEY (reported_by) REFERENCES users(id),
  INDEX idx_bug_reports_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
