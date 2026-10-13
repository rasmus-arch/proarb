-- =============================================================================
-- NOLLSTÄLLNING INFÖR LANSERING — raderar ALL affärsdata
-- =============================================================================
--
-- Tar bort: alla produkter (med varianter, lager, inköp, inventeringar,
-- produktpaket, prislistor), alla kunder (med kontakter, loggor, rabatter,
-- sortiment, Sortilog-konton och -beställningar, ordermallar), alla
-- offerter och alla ordrar (med utlämningar, returer och fakturarader),
-- samt kategorier och varumärken.
--
-- Behålls: användare och inloggningar, inställningar (företagsuppgifter,
-- logga, e-post, Fortnox-koppling), leverantörer, tryckmetoder, lager
-- (Butik) och felrapporter. Ordernummer och offertnummer börjar om på 1.
--
-- INNAN DU KÖR:
--   1. Ta en säkerhetskopia (Inställningar → Säkerhetskopior, eller
--      Export i phpMyAdmin). Det går inte att ångra.
--   2. Kontrollera att miljövariabeln SEED_DEMO_DATA INTE är "true" i
--      cPanel → Setup Node.js App — annars läggs demodatan tillbaka vid
--      nästa omstart.
--
-- KÖR: phpMyAdmin → välj databasen → fliken SQL → klistra in hela filen →
-- Kör. Eller från terminalen: mysql -u ANVÄNDARE -p DATABAS < reset-for-launch.sql
--
-- EFTERÅT: starta om appen (cPanel → Setup Node.js App → Restart). Vid
-- start skapas Swish-kunden (kontantkunden) automatiskt igen. Uppladdade
-- filer (kundloggor, produktbilder) ligger kvar i mappen uploads/ på
-- servern men syns inte längre någonstans — de kan raderas för hand.
-- Kunder och fakturor i Fortnox påverkas inte.
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- Ordrar, fakturor och returer
TRUNCATE TABLE order_return_lines;
TRUNCATE TABLE order_returns;
TRUNCATE TABLE order_pickups;
TRUNCATE TABLE order_lines;
TRUNCATE TABLE invoices;
TRUNCATE TABLE orders;
TRUNCATE TABLE order_template_lines;
TRUNCATE TABLE order_templates;
TRUNCATE TABLE fortnox_unpaid_invoices;

-- Gamla kassan (borttagen funktion, tabellerna finns kvar)
TRUNCATE TABLE payments;
TRUNCATE TABLE sale_lines;
TRUNCATE TABLE sales;
TRUNCATE TABLE pos_sessions;

-- Offerter
TRUNCATE TABLE quote_events;
TRUNCATE TABLE quote_lines;
TRUNCATE TABLE quotes;

-- Kunder och Sortilog
TRUNCATE TABLE portal_order_request_lines;
TRUNCATE TABLE portal_order_requests;
TRUNCATE TABLE portal_password_tokens;
TRUNCATE TABLE portal_sessions;
TRUNCATE TABLE portal_accounts;
TRUNCATE TABLE customer_assortment;
TRUNCATE TABLE customer_discounts;
TRUNCATE TABLE customer_logos;
TRUNCATE TABLE customer_contacts;
TRUNCATE TABLE customers;

-- Lager, inköp och inventering
TRUNCATE TABLE stock_count_shelves;
TRUNCATE TABLE stock_count_lines;
TRUNCATE TABLE stock_counts;
TRUNCATE TABLE purchase_order_lines;
TRUNCATE TABLE purchase_orders;
TRUNCATE TABLE stock_movements;
TRUNCATE TABLE stock_levels;

-- Produkter
TRUNCATE TABLE price_list_items;
TRUNCATE TABLE price_lists;
TRUNCATE TABLE product_kit_lines;
TRUNCATE TABLE product_kits;
TRUNCATE TABLE product_suppliers;
TRUNCATE TABLE product_variants;
TRUNCATE TABLE products;
-- Kategorier och varumärken skapas igen automatiskt vid produktimporten.
TRUNCATE TABLE product_categories;
TRUNCATE TABLE brands;
-- Vill du även börja om med leverantörerna, ta bort "-- " på raden nedan.
-- TRUNCATE TABLE suppliers;

SET FOREIGN_KEY_CHECKS = 1;

-- Numreringen börjar om, betalstatus från Fortnox hämtas på nytt.
UPDATE app_settings
SET next_order_number = 1,
    next_quote_number = 1,
    fortnox_unpaid_synced_at = NULL
WHERE id = 1;
