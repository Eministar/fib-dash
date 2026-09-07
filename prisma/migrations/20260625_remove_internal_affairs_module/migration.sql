-- Internal Affairs (and legacy Detective) module wird komplett entfernt.
-- Vorhandene Daten werden verlustfrei auf neutrale Werte umgehängt, bevor die
-- Enum-Werte gedroppt werden (ein ALTER auf eine ENUM mit noch referenzierten
-- Werten würde sonst fehlschlagen).
UPDATE `TaskList` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE');
UPDATE `SruFolder` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE');
UPDATE `SruDocument` SET `module` = 'SRU' WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE');
UPDATE `CalendarEvent` SET `module` = NULL WHERE `module` IN ('INTERNAL_AFFAIRS', 'DETECTIVE');
UPDATE `CalendarEvent` SET `type` = 'OTHER' WHERE `type` IN ('INTERNAL_AFFAIRS_BRIEFING', 'INTERNAL_AFFAIRS_CASE', 'DETECTIVE_BRIEFING', 'DETECTIVE_CASE');

ALTER TABLE `TaskList`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL;
ALTER TABLE `SruFolder`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL DEFAULT 'SRU';
ALTER TABLE `SruDocument`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NOT NULL DEFAULT 'SRU';
ALTER TABLE `CalendarEvent`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT') NULL,
  MODIFY `type` ENUM('TRAINING', 'MEETING', 'ACADEMY', 'EXAM', 'HR_DEADLINE', 'SRU_TRAINING', 'SRU_OPERATION', 'AIR_SUPPORT_TRAINING', 'AIR_SUPPORT_OPERATION', 'OTHER') NOT NULL DEFAULT 'OTHER';

-- Internal-Affairs-Unit entfernen (Officer.unit ist nur ein String-Key ohne FK).
DELETE FROM `Unit` WHERE `key` = 'INTERNAL_AFFAIRS';
