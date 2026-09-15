-- Optional demo data — NOT applied automatically like schema.sql/seed.sql.
-- Gives three customers with real-looking history (mixed offert-statusar,
-- flera ordrar per kund, en levererad order med utlämning, en
-- kassaförsäljning, en inleverans) so the system can be demoed properly,
-- not just a single bare-bones example. Safe to run more than once
-- (INSERT IGNORE on fixed ids). Do NOT run this against a real production
-- database — it adds fake customers/quotes/orders/sales that would show
-- up alongside real ones.

-- ---------------------------------------------------------------------------
-- Staff (samma lösenord som admin: "changeme")
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO users (id, name, email, password_hash, role)
VALUES
  (2, 'Sara Försäljning', 'sara@example.com', '$2b$10$0rrZunXcEcKdRpeMYWwd/OC2xRNLrjuHKwuEkuFvns9f3QbWYx76e', 'SALES'),
  (3, 'Lars Lager', 'lars@example.com', '$2b$10$0rrZunXcEcKdRpeMYWwd/OC2xRNLrjuHKwuEkuFvns9f3QbWYx76e', 'WAREHOUSE');

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO customers
  (id, customer_number, name, org_number, email, phone, address, postal_code, city, payment_terms_days)
VALUES
  (1, 'K-DEMO-1', 'Eskilstuna Bygg AB', '556677-8899', 'info@eskilstunabygg.example', '016-123 45 67',
   'Industrigatan 4', '632 20', 'Eskilstuna', 30),
  (2, 'K-DEMO-2', 'Mälardalens Städ & Service AB', '556112-2334', 'kontakt@malardalenstad.example', '016-987 65 43',
   'Verkstadsvägen 12', '633 46', 'Eskilstuna', 30),
  (3, 'K-DEMO-3', 'Sörmlands El & Automation AB', '556890-1122', 'info@sormlandsel.example', '016-555 44 33',
   'Kraftgatan 8', '633 41', 'Eskilstuna', 20);

INSERT IGNORE INTO customer_contacts
  (id, customer_id, name, email, phone, role, can_pickup)
VALUES
  (1, 1, 'Anna Karlsson', 'anna.karlsson@eskilstunabygg.example', '070-111 22 33', 'Inköpsansvarig', 1),
  (2, 2, 'Erik Lindqvist', 'erik.lindqvist@malardalenstad.example', '070-444 55 66', 'Platschef', 1),
  (3, 1, 'Björn Ohlsson', 'bjorn.ohlsson@eskilstunabygg.example', '070-222 33 44', 'VD', 0),
  (4, 2, 'Sara Nilsson', 'sara.nilsson@malardalenstad.example', '070-555 66 77', 'Ekonomi', 0),
  (5, 3, 'Johan Fransson', 'johan.fransson@sormlandsel.example', '070-777 88 99', 'Inköp', 1),
  (6, 3, 'Lena Berg', 'lena.berg@sormlandsel.example', '070-888 99 00', 'Administratör', 0);

-- ---------------------------------------------------------------------------
-- Products & variants
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO products
  (id, article_number, name, printable, unit, tax_rate_percent, base_price, cost_price)
VALUES
  (1, 'ART-DEMO-1', 'T-shirt Bomull', 1, 'st', 25.00, 89.00, 45.00),
  (2, 'ART-DEMO-2', 'Softshelljacka', 1, 'st', 25.00, 450.00, 270.00),
  (3, 'ART-DEMO-3', 'Fleecetröja', 1, 'st', 25.00, 320.00, 190.00),
  (4, 'ART-DEMO-4', 'Keps', 1, 'st', 25.00, 79.00, 32.00),
  (5, 'ART-DEMO-5', 'Arbetsbyxor', 0, 'st', 25.00, 395.00, 240.00);

INSERT IGNORE INTO product_variants
  (id, product_id, sku, barcode, color, size)
VALUES
  (1, 1, 'TS-DEMO-SVART-M', '7300000000011', 'Svart', 'M'),
  (2, 1, 'TS-DEMO-SVART-L', '7300000000012', 'Svart', 'L'),
  (3, 2, 'SSJ-DEMO-MARIN-L', '7300000000021', 'Marin', 'L'),
  (4, 1, 'TS-DEMO-VIT-M', '7300000000013', 'Vit', 'M'),
  (5, 2, 'SSJ-DEMO-MARIN-XL', '7300000000022', 'Marin', 'XL'),
  (6, 3, 'FL-DEMO-GRA-M', '7300000000031', 'Grå', 'M'),
  (7, 3, 'FL-DEMO-GRA-L', '7300000000032', 'Grå', 'L'),
  (8, 4, 'KP-DEMO-SVART-OS', '7300000000041', 'Svart', 'One Size'),
  (9, 5, 'BX-DEMO-MARIN-50', '7300000000051', 'Marin', '50'),
  (10, 5, 'BX-DEMO-MARIN-52', '7300000000052', 'Marin', '52');

INSERT IGNORE INTO stock_levels (product_variant_id, warehouse_id, quantity_on_hand, reserved_qty, reorder_point, reorder_quantity)
VALUES
  (1, 1, 40, 0, 10, 50),
  (2, 1, 30, 0, 10, 50),
  (3, 1, 12, 0, 5, 20),
  (4, 1, 22, 0, 10, 50),
  (5, 1, 8, 0, 5, 20),
  (6, 1, 18, 0, 10, 40),
  (7, 1, 15, 0, 10, 40),
  (8, 1, 60, 0, 20, 100),
  (9, 1, 14, 0, 5, 20),
  (10, 1, 11, 0, 5, 20);

-- ---------------------------------------------------------------------------
-- Leverantör + inleverans (lager-fliken får också lite historik)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO suppliers (id, name, email, phone)
VALUES (1, 'Nordic Profil Grossist', 'order@nordicprofil.example', '08-111 22 33');

INSERT IGNORE INTO product_suppliers (id, product_id, supplier_id, supplier_sku, cost_price, lead_time_days)
VALUES
  (1, 1, 1, 'NPG-TS-001', 45.00, 5),
  (2, 3, 1, 'NPG-FL-003', 190.00, 7);

INSERT IGNORE INTO purchase_orders (id, supplier_id, status, expected_date, created_at)
VALUES (1, 1, 'RECEIVED', DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 9 DAY));

INSERT IGNORE INTO purchase_order_lines (id, purchase_order_id, product_variant_id, quantity, received_qty, cost_price)
VALUES
  (1, 1, 1, 30, 30, 45.00),
  (2, 1, 6, 20, 20, 190.00);

INSERT IGNORE INTO stock_movements
  (id, product_variant_id, warehouse_id, type, quantity, reference_type, reference_id, note, created_by, created_at)
VALUES
  (1, 1, 1, 'PURCHASE_IN', 30, 'purchase_order', 1, 'Inleverans NPG-TS-001', 3, DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (2, 6, 1, 'PURCHASE_IN', 20, 'purchase_order', 1, 'Inleverans NPG-FL-003', 3, DATE_SUB(NOW(), INTERVAL 2 DAY));

-- ---------------------------------------------------------------------------
-- Offerter — blandade statusar över de tre kunderna
-- ---------------------------------------------------------------------------

-- Eskilstuna Bygg AB: en konverterad (till order 1), en avböjd, ett utkast
INSERT IGNORE INTO quotes
  (id, quote_number, customer_id, reference_contact_id, status, valid_until, public_token, notes,
   created_by, sent_at, viewed_at, responded_at)
VALUES
  (1, 'OFF-DEMO-1', 1, 1, 'CONVERTED', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   '1ac910c1d0a3d3f6b7e612f2802cd5959d733ba9a811b68b',
   'Exempeloffert för att visa flödet kund → offert → order → tryckorder.',
   2, DATE_SUB(NOW(), INTERVAL 12 DAY), DATE_SUB(NOW(), INTERVAL 11 DAY), DATE_SUB(NOW(), INTERVAL 11 DAY)),
  (3, 'OFF-DEMO-3', 1, 3, 'DECLINED', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   '77a1f0b6e0c94b8b9f2f4e5a3d1c7f6e8b0a9d2c3e4f5061',
   NULL, 2, DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY), DATE_SUB(NOW(), INTERVAL 18 DAY)),
  (4, 'OFF-DEMO-4', 1, 1, 'DRAFT', NULL,
   '3d4e5f6071829304a5b6c7d8e9f0a1b2c3d4e5f60718293a',
   'Väntar på pris från leverantör innan den skickas.', 2, NULL, NULL, NULL);

INSERT IGNORE INTO quote_lines
  (id, quote_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order)
VALUES
  (1, 1, 1, 25, 89.00, 1, 'Logga bröst, vit', 0),
  (2, 1, 3, 10, 450.00, 2, 'Logga rygg, stor', 1),
  (4, 3, 8, 100, 79.00, 3, 'Logga front', 0),
  (5, 4, 9, 15, 395.00, NULL, NULL, 0);

-- Mälardalens Städ & Service AB: en skickad (väntar svar), en konverterad (till order 3)
INSERT IGNORE INTO quotes
  (id, quote_number, customer_id, reference_contact_id, status, valid_until, public_token,
   created_by, sent_at, viewed_at, responded_at)
VALUES
  (2, 'OFF-DEMO-2', 2, 2, 'SENT', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   'cc1aa23d8fb0e780b4ce240113c9d92f94caee3c2062679c',
   1, DATE_SUB(NOW(), INTERVAL 1 DAY), NULL, NULL),
  (5, 'OFF-DEMO-5', 2, 2, 'CONVERTED', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   '9e8d7c6b5a4938271605f4e3d2c1b0a9887766554433221',
   1, DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 7 DAY));

INSERT IGNORE INTO quote_lines
  (id, quote_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order)
VALUES
  (3, 2, 2, 15, 89.00, 4, 'Logga bröst', 0),
  (6, 5, 6, 20, 320.00, 2, 'Logga rygg', 0);

-- Sörmlands El & Automation AB: kunden har öppnat länken men inte svarat än
INSERT IGNORE INTO quotes
  (id, quote_number, customer_id, reference_contact_id, status, valid_until, public_token,
   created_by, sent_at, viewed_at)
VALUES
  (6, 'OFF-DEMO-6', 3, 5, 'VIEWED', DATE_ADD(CURDATE(), INTERVAL 30 DAY),
   'a0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f6071',
   1, DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY));

INSERT IGNORE INTO quote_lines
  (id, quote_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order)
VALUES
  (7, 6, 4, 30, 89.00, 1, 'Logga bröst', 0);

-- ---------------------------------------------------------------------------
-- Ordrar — olika statusar, en fullt levererad med utlämning
-- ---------------------------------------------------------------------------

-- Order 1: konverterad från offert 1, fortfarande i produktion (fyller tryckkön)
INSERT IGNORE INTO orders
  (id, order_number, customer_id, reference_contact_id, quote_id, status, delivery_method, created_by)
VALUES
  (1, 'ORD-DEMO-1', 1, 1, 1, 'IN_PRODUCTION', 'PICKUP', 2);

INSERT IGNORE INTO order_lines
  (id, order_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order, print_status)
VALUES
  (1, 1, 1, 25, 89.00, 1, 'Logga bröst, vit', 0, 'IN_PRODUCTION'),
  (2, 1, 3, 10, 450.00, 2, 'Logga rygg, stor', 1, 'WAITING');

-- Order 2: direktorder (utan offert) hos samma kund, redan levererad och
-- utlämnad — visar hela kedjan till slutet.
INSERT IGNORE INTO orders
  (id, order_number, customer_id, reference_contact_id, quote_id, status, delivery_method, created_by, created_at)
VALUES
  (2, 'ORD-DEMO-2', 1, 1, NULL, 'DELIVERED', 'PICKUP', 2, DATE_SUB(NOW(), INTERVAL 15 DAY));

INSERT IGNORE INTO order_lines
  (id, order_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order, print_status)
VALUES
  (3, 2, 1, 5, 89.00, 1, 'Logga bröst, vit', 0, 'READY'),
  (4, 2, 6, 5, 320.00, 2, 'Logga rygg', 1, 'READY');

INSERT IGNORE INTO order_pickups
  (id, order_id, picked_up_by_contact_id, picked_up_at, verified_by_user_id)
VALUES
  (1, 2, 1, DATE_SUB(NOW(), INTERVAL 10 DAY), 2);

-- Order 3: konverterad från offert 5 (Mälardalens), redo för avhämtning
INSERT IGNORE INTO orders
  (id, order_number, customer_id, reference_contact_id, quote_id, status, delivery_method, created_by, created_at)
VALUES
  (3, 'ORD-DEMO-3', 2, 2, 5, 'READY_FOR_PICKUP', 'PICKUP', 1, DATE_SUB(NOW(), INTERVAL 6 DAY));

INSERT IGNORE INTO order_lines
  (id, order_id, product_variant_id, quantity, unit_price, print_method_id, print_description, sort_order, print_status)
VALUES
  (5, 3, 6, 20, 320.00, 2, 'Logga rygg', 0, 'READY');

-- Order 4: direktorder utan tryck (rena arbetsbyxor), nyss bekräftad
INSERT IGNORE INTO orders
  (id, order_number, customer_id, reference_contact_id, quote_id, status, delivery_method, created_by, created_at)
VALUES
  (4, 'ORD-DEMO-4', 1, 3, NULL, 'CONFIRMED', 'SHIPPING', 2, DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT IGNORE INTO order_lines
  (id, order_id, product_variant_id, quantity, unit_price, sort_order)
VALUES
  (6, 4, 9, 15, 395.00, 0);

-- ---------------------------------------------------------------------------
-- Kassa — en genomförd försäljning kopplad till en kund
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO pos_sessions (id, name, opened_by, opened_at, closed_at, opening_float, closing_float)
VALUES (1, 'Kassa 1 – Demo', 3, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 5 DAY), 500.00, 1740.00);

INSERT IGNORE INTO sales (id, sale_number, session_id, customer_id, cashier_id, status, created_at)
VALUES (1, 'SALE-DEMO-1', 1, 3, 3, 'COMPLETED', DATE_SUB(NOW(), INTERVAL 5 DAY));

INSERT IGNORE INTO sale_lines (id, sale_id, product_variant_id, quantity, unit_price)
VALUES (1, 1, 8, 10, 79.00);

INSERT IGNORE INTO payments (id, sale_id, method, amount)
VALUES (1, 1, 'CARD', 987.50);
