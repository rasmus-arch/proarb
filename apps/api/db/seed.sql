-- Minimal reference data so the app is usable right after migrating.

-- Single warehouse only — ProArb doesn't model multiple stock locations.
INSERT IGNORE INTO warehouses (id, name) VALUES (1, 'Butik');

INSERT IGNORE INTO print_methods (id, name) VALUES
  (1, 'Brodyr'),
  (2, 'Screentryck'),
  (3, 'Transfer'),
  (4, 'DTF');

-- Default admin user. Password is "changeme" (bcryptjs hash) – change it
-- via Inställningar → Användare on first login.
INSERT IGNORE INTO users (id, name, email, password_hash, role)
VALUES (1, 'Admin', 'admin@example.com', '$2b$10$0rrZunXcEcKdRpeMYWwd/OC2xRNLrjuHKwuEkuFvns9f3QbWYx76e', 'ADMIN');

-- Det här systemet är byggt specifikt för Profil & Arbetskläder i
-- Eskilstuna AB (inte en generisk multi-tenant-produkt), så det riktiga
-- företagsnamnet är en rimlig standard direkt vid installation istället
-- för platshållartexten "Mitt företag". Guardat på den exakta
-- platshållaren så en redan ifylld/ändrad rad (via Inställningar) aldrig
-- skrivs över av en omkörning av migrate.js.
UPDATE app_settings SET seller_name = 'Profil & Arbetskläder i Eskilstuna AB'
  WHERE id = 1 AND seller_name = 'Mitt företag';
