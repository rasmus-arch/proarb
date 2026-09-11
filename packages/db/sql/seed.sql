-- Minimal reference data so the app is usable right after migrating.

INSERT IGNORE INTO warehouses (id, name) VALUES (1, 'Butik'), (2, 'Centrallager');

INSERT IGNORE INTO print_methods (id, name) VALUES
  (1, 'Brodyr'),
  (2, 'Screentryck'),
  (3, 'Transfer'),
  (4, 'DTF');

-- Default admin user. Password is "changeme" (bcrypt hash) – change on first login.
INSERT IGNORE INTO users (id, name, email, password_hash, role)
VALUES (1, 'Admin', 'admin@example.com', '$2b$10$CwTycUXWue0Thq9StjUM0uJ8u1yvMZE.ep0lIVzYlgw72u2xVpS5W', 'ADMIN');
