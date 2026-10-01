-- Qualitätskontrollen: Zwischennoten (1+, 1−, …) und bearbeitbare Protokolleinträge.
-- Bestehende ganze Noten bleiben unverändert gültig.
-- Setzt 2026-10-01-lspd-quality-checks.sql voraus. Alternativ zu `npm run db:push`, nicht beides.

-- Falls die Spalte noch fehlt, stattdessen: ALTER TABLE `QualityCheck` ADD COLUMN `grade` DOUBLE NULL;
ALTER TABLE `QualityCheck` MODIFY `grade` DOUBLE NULL;

ALTER TABLE `QualityCheckEntry` ADD COLUMN `editedAt` DATETIME(3) NULL;
