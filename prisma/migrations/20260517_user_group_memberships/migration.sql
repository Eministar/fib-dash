CREATE TABLE `UserGroupMembership` (
    `userId` VARCHAR(191) NOT NULL,
    `groupId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserGroupMembership_groupId_idx`(`groupId`),
    PRIMARY KEY (`userId`, `groupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `UserGroupMembership` (`userId`, `groupId`, `createdAt`)
SELECT `id`, `groupId`, CURRENT_TIMESTAMP(3)
FROM `User`
WHERE `groupId` IS NOT NULL;

ALTER TABLE `UserGroupMembership`
ADD CONSTRAINT `UserGroupMembership_userId_fkey`
FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `UserGroupMembership`
ADD CONSTRAINT `UserGroupMembership_groupId_fkey`
FOREIGN KEY (`groupId`) REFERENCES `UserGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
