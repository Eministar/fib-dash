-- Qualitätskontrollen: Kontrollart (Streife, Verkehrskontrolle, Einsatzbegleitung, Sonstige).
-- Bestehende Kontrollen gelten als Streifenfahrt.
-- Setzt 2026-10-01-lspd-quality-checks.sql voraus. Alternativ zu `npm run db:push`, nicht beides.

ALTER TABLE `QualityCheck` ADD COLUMN `checkType` VARCHAR(20) NOT NULL DEFAULT 'PATROL';
