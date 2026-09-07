-- Make all user-referencing FK columns nullable with ON DELETE SET NULL
-- so that deleting a User does not crash with FK constraint violations.

-- PromotionLog.performedByUserId
ALTER TABLE `PromotionLog` MODIFY `performedByUserId` VARCHAR(191) NULL;
ALTER TABLE `PromotionLog` DROP FOREIGN KEY IF EXISTS `PromotionLog_performedByUserId_fkey`;
ALTER TABLE `PromotionLog` ADD CONSTRAINT `PromotionLog_performedByUserId_fkey`
  FOREIGN KEY (`performedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Termination.terminatedByUserId
ALTER TABLE `Termination` MODIFY `terminatedByUserId` VARCHAR(191) NULL;
ALTER TABLE `Termination` DROP FOREIGN KEY IF EXISTS `Termination_terminatedByUserId_fkey`;
ALTER TABLE `Termination` ADD CONSTRAINT `Termination_terminatedByUserId_fkey`
  FOREIGN KEY (`terminatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Sanction.issuedByUserId
ALTER TABLE `Sanction` MODIFY `issuedByUserId` VARCHAR(191) NULL;
ALTER TABLE `Sanction` DROP FOREIGN KEY IF EXISTS `Sanction_issuedByUserId_fkey`;
ALTER TABLE `Sanction` ADD CONSTRAINT `Sanction_issuedByUserId_fkey`
  FOREIGN KEY (`issuedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Note.authorId
ALTER TABLE `Note` MODIFY `authorId` VARCHAR(191) NULL;
ALTER TABLE `Note` DROP FOREIGN KEY IF EXISTS `Note_authorId_fkey`;
ALTER TABLE `Note` ADD CONSTRAINT `Note_authorId_fkey`
  FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog.userId
ALTER TABLE `AuditLog` MODIFY `userId` VARCHAR(191) NULL;
ALTER TABLE `AuditLog` DROP FOREIGN KEY IF EXISTS `AuditLog_userId_fkey`;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RankChangeList.createdById
ALTER TABLE `RankChangeList` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `RankChangeList` DROP FOREIGN KEY IF EXISTS `RankChangeList_createdById_fkey`;
ALTER TABLE `RankChangeList` ADD CONSTRAINT `RankChangeList_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- TaskList.createdById
ALTER TABLE `TaskList` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `TaskList` DROP FOREIGN KEY IF EXISTS `TaskList_createdById_fkey`;
ALTER TABLE `TaskList` ADD CONSTRAINT `TaskList_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Task.createdById
ALTER TABLE `Task` MODIFY `createdById` VARCHAR(191) NULL;
ALTER TABLE `Task` DROP FOREIGN KEY IF EXISTS `Task_createdById_fkey`;
ALTER TABLE `Task` ADD CONSTRAINT `Task_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
