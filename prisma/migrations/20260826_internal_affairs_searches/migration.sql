ALTER TABLE `TaskList`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE', 'INTERNAL_AFFAIRS') NOT NULL;

ALTER TABLE `SruFolder`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE', 'INTERNAL_AFFAIRS') NOT NULL DEFAULT 'SRU';

ALTER TABLE `SruDocument`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE', 'INTERNAL_AFFAIRS') NOT NULL DEFAULT 'SRU';

ALTER TABLE `CalendarEvent`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE', 'INTERNAL_AFFAIRS') NULL;

ALTER TABLE `FormTest`
  MODIFY `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE', 'INTERNAL_AFFAIRS') NOT NULL;

CREATE TABLE `OfficerSearch` (
  `id` VARCHAR(191) NOT NULL,
  `officerId` VARCHAR(191) NOT NULL,
  `conductedAt` DATETIME(3) NOT NULL,
  `prohibitedItemsFound` BOOLEAN NOT NULL DEFAULT false,
  `foundItems` TEXT NOT NULL,
  `notes` TEXT NULL,
  `createdById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `OfficerSearch_officerId_conductedAt_idx`(`officerId`, `conductedAt`),
  INDEX `OfficerSearch_createdById_idx`(`createdById`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OfficerSearch`
  ADD CONSTRAINT `OfficerSearch_officerId_fkey`
  FOREIGN KEY (`officerId`) REFERENCES `Officer`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `OfficerSearch`
  ADD CONSTRAINT `OfficerSearch_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
