-- Add source field to UserGroupMembership to distinguish Discord-synced vs manually assigned groups
ALTER TABLE `UserGroupMembership` ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'discord';
CREATE INDEX `UserGroupMembership_userId_source_idx` ON `UserGroupMembership`(`userId`, `source`);
