-- Freigabelinks können einen Razzia-Antrag als Anschreiben tragen.
-- Alternativ zu `npm run db:push`, nicht beides.

ALTER TABLE `RecordShare` ADD COLUMN `raidRequest` JSON NULL;
