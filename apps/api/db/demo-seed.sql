-- Optional demo data — NOT applied automatically like schema.sql/seed.sql.
-- Gives a full kund → offert → order → tryckorder flow to click through,
-- for demoing the system. Safe to run more than once (INSERT IGNORE on
-- fixed ids). Do NOT run this against a real production database — it
-- adds fake customers/quotes/orders that would show up alongside real
-- ones. See DEPLOY-CPANEL.md for how to enable it (SEED_DEMO_DATA=true)
-- or run it manually via phpMyAdmin.

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO customers
  (id, customer_number, name, org_number, email, phone, address, postal_code, city, payment_terms_days)
VALUES
  (1, 'K-DEMO-1', 'Eskilstuna Bygg AB', '556677-8899', 'info@eskilstunabygg.example', '016-123 45 67',
   'Industrigatan 4', '632 20', 'Eskilstuna', 30),
  (2, 'K-DEMO-2', 'Mälardalens Städ & Service AB', '556112-2334', 'kontakt@malardalenstad.example', '016-987 65 43',
   'Verkstadsvägen 12', '633 46', 'Eskilstuna', 30);

INSERT IGNORE INTO customer_contacts
  (id, customer_id, name, email, phone, role, can_pickup)
VALUES
  (1, 1, 'Anna Karlsson', 'anna.karlsson@eskilstunabygg.example', '070-111 22 33', 'Inköpsansvarig', 1),
  (2, 2, 'Erik Lindqvist', 'erik.lindqvist@malardalenstad.example', '070-444 55 66', 'Platschef', 1);

-- ---------------------------------------------------------------------------
-- Products & variants (printable profile plagg)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO products
  (id, article_number, name, printable, unit, tax_rate_percent, base_price, cost_price)
VALUES
  (1, 'ART-DEMO-1', 'T-shirt Bomull', 1, 'st', 25.00, 89.00, 45.00),
  (2, 'ART-DEMO-2', 'Softshelljacka', 1, 'st', 25.00, 450.00, 270.00);

INSERT IGNORE INTO product_variants
  (id, product_id, sku, barcode, color, size)
VALUES
  (1, 1, 'TS-DEMO-SVART-M', '7300000000011', 'Svart', 'M'),
  (2, 1, 'TS-DEMO-SVART-L', '7300000000012', 'Svart', 'L'),
  (3, 2, 'SSJ-DEMO-MARIN-L', '7300000000021', 'Marin', 'L');

INSERT IGNORE INTO stock_levels (product_variant_id, warehouse_id, quantity_on_hand, reorder_point, reorder_quantity)
VALUES
  (1, 1, 40, 10, 50),
  (2, 1, 25, 10, 50),
  (3, 1, 15, 5, 20);

-- ---------------------------------------------------------------------------
-- Offert 1: accepted and already converted to order (see below)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO quotes
  (id, quote_number, customer_id, reference_contact_id, status, valid_until, public_token, notes,
   created_by, sent_at, viewed_at, responded_at)
VALUES
  (1, 'OFF-DEMO-1', 1, 1, 'CONVERTED', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   '1ac910c1d0a3d3f6b7e612f2802cd5959d733ba9a811b68b',
   'Exempeloffert för att visa flödet kund → offert → order → tryckorder.',
   1, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY));

INSERT IGNORE INTO quote_lines
  (id, quote_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order)
VALUES
  (1, 1, 1, 25, 89.00, 1, 'Logga bröst, vit', 0),
  (2, 1, 3, 10, 450.00, 2, 'Logga rygg, stor', 1);

-- ---------------------------------------------------------------------------
-- Offert 2: skickad, väntar på svar — visar flödet i ett tidigare steg
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO quotes
  (id, quote_number, customer_id, reference_contact_id, status, valid_until, public_token,
   created_by, sent_at)
VALUES
  (2, 'OFF-DEMO-2', 2, 2, 'SENT', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   'cc1aa23d8fb0e780b4ce240113c9d92f94caee3c2062679c',
   1, DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT IGNORE INTO quote_lines
  (id, quote_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order)
VALUES
  (3, 2, 2, 15, 89.00, 4, 'Logga bröst', 0);

-- ---------------------------------------------------------------------------
-- Order (konverterad från offert 1) — en rad redan i produktion, en väntar
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO orders
  (id, order_number, customer_id, reference_contact_id, quote_id, status, delivery_method, created_by)
VALUES
  (1, 'ORD-DEMO-1', 1, 1, 1, 'IN_PRODUCTION', 'PICKUP', 1);

INSERT IGNORE INTO order_lines
  (id, order_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order, print_status)
VALUES
  (1, 1, 1, 25, 89.00, 1, 'Logga bröst, vit', 0, 'IN_PRODUCTION'),
  (2, 1, 3, 10, 450.00, 2, 'Logga rygg, stor', 1, 'WAITING');
