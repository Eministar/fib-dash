-- Verschlusssachen entfallen: alle Einsatzakten sind für jeden mit Akteneinsicht sichtbar.
-- Zusätzlich Discord-Forum-Beiträge je Einsatzakte und Dauerakte.
-- Alternativ zu `npm run db:push`, nicht beides. Vorher sichern (`npm run db:backup`).

-- Mit der Spalte entfällt die Einstufung; jede bisherige Verschlusssache ist danach offen.
ALTER TABLE `Investigation` DROP COLUMN `classified`;
ALTER TABLE `InvestigationTemplate` DROP COLUMN `classified`;
ALTER TABLE `RecordShareItem` DROP COLUMN `classifiedAtGrant`;

ALTER TABLE `Investigation` ADD COLUMN `discordThreadId` VARCHAR(32) NULL;
ALTER TABLE `Dossier` ADD COLUMN `discordThreadId` VARCHAR(32) NULL;

-- Das Recht „Verschlusssachen einsehen“ gibt es nicht mehr. Unbekannte Rechte
-- ignoriert die App ohnehin; hier wird es nur aus den Gruppen entfernt.
UPDATE `UserGroup` SET `permissions` = REPLACE(REPLACE(REPLACE(`permissions`, '"investigations:classified",', ''), ',"investigations:classified"', ''), '"investigations:classified"', '') WHERE `permissions` LIKE '%investigations:classified%';
