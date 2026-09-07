ALTER TABLE `Training` ADD COLUMN `minRankId` VARCHAR(191) NULL;

CREATE INDEX `Training_minRankId_idx` ON `Training`(`minRankId`);

ALTER TABLE `Training`
  ADD CONSTRAINT `Training_minRankId_fkey`
  FOREIGN KEY (`minRankId`) REFERENCES `Rank`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
