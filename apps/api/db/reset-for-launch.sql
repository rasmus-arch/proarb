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
-- Kör. Filen går att köra igen om den avbrutits halvvägs. Eller från terminalen: mysql -u ANVÄNDARE -p DATABAS < reset-for-launch.sql
--
-- EFTERÅT: starta om appen (cPanel → Setup Node.js App → Restart). Vid
-- start skapas Swish-kunden (kontantkunden) automatiskt igen. Uppladdade
-- filer (kundloggor, produktbilder) ligger kvar i mappen uploads/ på
-- servern men syns inte längre någonstans — de kan raderas för hand.
-- Kunder och fakturor i Fortnox påverkas inte.
-- =============================================================================

-- Raderingen sker i en ordning där varje tabell töms innan tabellen den
-- pekar på — så filen fungerar även om phpMyAdmin har "Enable foreign key
-- checks" ikryssat (då ignoreras raden nedan). DELETE i stället för
-- TRUNCATE, eftersom MySQL aldrig tillåter TRUNCATE på en tabell som
-- andra tabeller pekar på.
SET FOREIGN_KEY_CHECKS = 0;

-- Ordrar, fakturor och returer
DELETE FROM order_return_lines;
DELETE FROM order_returns;
DELETE FROM order_pickups;
DELETE FROM order_lines;
DELETE FROM invoices;
DELETE FROM order_template_lines;
DELETE FROM order_templates;
DELETE FROM fortnox_unpaid_invoices;

-- Gamla kassan (borttagen funktion, tabellerna finns kvar)
DELETE FROM payments;
DELETE FROM sale_lines;
DELETE FROM sales;
DELETE FROM pos_sessions;

-- Offerter och Sortilog-beställningar (före ordrarna, som pekar på dem)
DELETE FROM quote_events;
DELETE FROM quote_lines;
DELETE FROM portal_order_request_lines;
DELETE FROM portal_order_requests;
DELETE FROM orders;
DELETE FROM quotes;

-- Kunder och Sortilog-konton
DELETE FROM portal_password_tokens;
DELETE FROM portal_sessions;
DELETE FROM portal_accounts;
DELETE FROM customer_assortment;
DELETE FROM customer_discounts;
DELETE FROM customer_logos;
DELETE FROM customer_contacts;
DELETE FROM customers;

-- Lager, inköp och inventering
DELETE FROM stock_count_shelves;
DELETE FROM stock_count_lines;
DELETE FROM stock_counts;
DELETE FROM purchase_order_lines;
DELETE FROM purchase_orders;
DELETE FROM stock_movements;
DELETE FROM stock_levels;

-- Produkter
DELETE FROM price_list_items;
DELETE FROM price_lists;
DELETE FROM product_kit_lines;
DELETE FROM product_kits;
DELETE FROM product_suppliers;
DELETE FROM product_variants;
DELETE FROM products;
-- Kategorier och varumärken skapas igen automatiskt vid produktimporten.
-- Underkategorier pekar på sin överkategori — lossa dem först.
UPDATE product_categories SET parent_id = NULL;
DELETE FROM product_categories;
DELETE FROM brands;
-- Vill du även börja om med leverantörerna, ta bort "-- " på raden nedan.
-- DELETE FROM suppliers;

SET FOREIGN_KEY_CHECKS = 1;

-- Numreringen börjar om, betalstatus från Fortnox hämtas på nytt.
UPDATE app_settings
SET next_order_number = 1,
    next_quote_number = 1,
    fortnox_unpaid_synced_at = NULL
WHERE id = 1;
