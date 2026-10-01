-- Benachrichtigungen (Glocke/Inbox) und Beweiskette der Asservate.
-- Rein additiv: nur neue Tabellen. Alternativ zu `npm run db:push`, nicht beides.
-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(500) NULL,
    `href` VARCHAR(500) NULL,
    `userId` VARCHAR(191) NULL,
    `permission` VARCHAR(60) NULL,
    `actorId` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Notification_dedupeKey_key`(`dedupeKey`),
    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_permission_createdAt_idx`(`permission`, `createdAt`),
    INDEX `Notification_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `notificationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationReceipt_userId_idx`(`userId`),
    UNIQUE INDEX `NotificationReceipt_notificationId_userId_key`(`notificationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EvidenceCustodyEvent` (
    `id` VARCHAR(191) NOT NULL,
    `chainKey` VARCHAR(191) NOT NULL,
    `evidenceId` VARCHAR(191) NULL,
    `itemNumber` VARCHAR(24) NOT NULL,
    `investigationId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(200) NOT NULL,
    `fromHolder` VARCHAR(200) NULL,
    `toHolder` VARCHAR(200) NULL,
    `location` VARCHAR(200) NULL,
    `note` TEXT NULL,
    `prevHash` VARCHAR(64) NULL,
    `hash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EvidenceCustodyEvent_chainKey_createdAt_idx`(`chainKey`, `createdAt`),
    INDEX `EvidenceCustodyEvent_evidenceId_createdAt_idx`(`evidenceId`, `createdAt`),
    INDEX `EvidenceCustodyEvent_investigationId_createdAt_idx`(`investigationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationReceipt` ADD CONSTRAINT `NotificationReceipt_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationReceipt` ADD CONSTRAINT `NotificationReceipt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EvidenceCustodyEvent` ADD CONSTRAINT `EvidenceCustodyEvent_evidenceId_fkey` FOREIGN KEY (`evidenceId`) REFERENCES `Evidence`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EvidenceCustodyEvent` ADD CONSTRAINT `EvidenceCustodyEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
