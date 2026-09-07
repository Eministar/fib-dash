CREATE TABLE `UnitGroup` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `color` VARCHAR(191) NOT NULL DEFAULT '#d4af37',
  `icon` VARCHAR(191) NOT NULL DEFAULT 'briefcase',
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `showInNavigation` BOOLEAN NOT NULL DEFAULT false,
  `modules` JSON NULL,
  `permissions` JSON NOT NULL,
  `memberDiscordRoleId` VARCHAR(191) NULL,
  `leadershipDiscordRoleId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `UnitGroup_key_key`(`key`),
  INDEX `UnitGroup_active_sortOrder_idx`(`active`, `sortOrder`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Unit`
  ADD COLUMN `discordRoleId` VARCHAR(191) NULL,
  ADD COLUMN `groupId` VARCHAR(191) NULL,
  ADD COLUMN `isLeadership` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `Unit_groupId_sortOrder_idx` ON `Unit`(`groupId`, `sortOrder`);

ALTER TABLE `Unit`
  ADD CONSTRAINT `Unit_groupId_fkey`
  FOREIGN KEY (`groupId`) REFERENCES `UnitGroup`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
