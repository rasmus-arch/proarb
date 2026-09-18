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
