-- =============================================================================
-- LEVERANTÖRER INFÖR LANSERING
-- =============================================================================
--
-- Lägger in alla leverantörer och tar bort övriga (t.ex. testleverantörer).
-- Kör den EFTER reset-for-launch.sql — innan dess pekar produkter och
-- inköpsordrar på de gamla leverantörerna och borttagningen stoppas.
-- Går att köra flera gånger: en leverantör som redan finns läggs inte in igen
-- (befintlig e-post, kundnummer m.m. behålls).
--
-- VIKTIGT vid produktimporten: kolumnen Leverantör i produktfilen måste
-- stavas som här, annars skapas en ny leverantör med den andra stavningen.
--
-- KÖR: phpMyAdmin → välj databasen → fliken SQL → klistra in hela filen → Kör.
-- =============================================================================

CREATE TEMPORARY TABLE launch_suppliers (name VARCHAR(255) NOT NULL, notes TEXT NULL);

INSERT INTO launch_suppliers (name, notes) VALUES
  ('Helly Hansen', NULL),
  ('Snickers', NULL),
  ('Jobman', NULL),
  ('Projob', NULL),
  ('Blåkläder', NULL),
  ('Fristads', NULL),
  ('Port west', NULL),
  ('Båstadgruppen', 'Varumärken: ATG, Björn Borg, Monitor'),
  ('Tegera Ejendals', NULL),
  ('Jalas Ejendals', NULL),
  ('Sievi', NULL),
  ('Solid Gear', NULL),
  ('Texstar', NULL),
  ('Tee Jays', NULL),
  ('Craft', NULL),
  ('ID Identity', NULL),
  ('Cutter & Buck', NULL),
  ('Clique', NULL),
  ('Printer', NULL),
  ('TGH', NULL),
  ('D&J', NULL),
  ('Vinga', NULL),
  ('New Wave', NULL),
  ('Segereurope', NULL),
  ('Segers Kockkläder', NULL);

-- Ta bort leverantörer som inte finns i listan.
DELETE FROM suppliers WHERE name NOT IN (SELECT name FROM launch_suppliers);

-- Lägg in de som saknas.
INSERT INTO suppliers (name, notes)
SELECT l.name, l.notes FROM launch_suppliers l
WHERE NOT EXISTS (SELECT 1 FROM suppliers s WHERE s.name = l.name);

DROP TEMPORARY TABLE launch_suppliers;

SELECT id, name, notes FROM suppliers ORDER BY name;
