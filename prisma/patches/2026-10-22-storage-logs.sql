-- Lagerlogs: Einträge aus dem Discord-Lagerlog und Warnungen bei auffälligen Entnahmen.
-- Rein additiv. Alternativ zu `npm run db:push`, nicht beides.

CREATE TABLE `StorageLogEntry` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(16) NOT NULL,
    `sourceKey` VARCHAR(64) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NOT NULL,
    `direction` VARCHAR(4) NOT NULL,
    `actorName` VARCHAR(120) NOT NULL,
    `agentId` VARCHAR(191) NULL,
    `item` VARCHAR(120) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `isWeapon` BOOLEAN NOT NULL DEFAULT false,
    `storage` VARCHAR(120) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `rawText` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StorageLogEntry_slug_key`(`slug`),
    UNIQUE INDEX `StorageLogEntry_sourceKey_key`(`sourceKey`),
    INDEX `StorageLogEntry_agentId_occurredAt_idx`(`agentId`, `occurredAt`),
    INDEX `StorageLogEntry_actorName_occurredAt_idx`(`actorName`, `occurredAt`),
    INDEX `StorageLogEntry_direction_occurredAt_idx`(`direction`, `occurredAt`),
    INDEX `StorageLogEntry_occurredAt_idx`(`occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `StorageAlert` (
    `id` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(16) NOT NULL,
    `agentId` VARCHAR(191) NULL,
    `actorName` VARCHAR(120) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `windowEnd` DATETIME(3) NOT NULL,
    `weaponCount` INTEGER NOT NULL,
    `itemCount` INTEGER NOT NULL,
    `entrySlugs` JSON NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StorageAlert_slug_key`(`slug`),
    INDEX `StorageAlert_actorName_createdAt_idx`(`actorName`, `createdAt`),
    INDEX `StorageAlert_agentId_createdAt_idx`(`agentId`, `createdAt`),
    INDEX `StorageAlert_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `StorageLogEntry` ADD CONSTRAINT `StorageLogEntry_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StorageAlert` ADD CONSTRAINT `StorageAlert_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Antworten aus Discord-Akten-Beiträgen werden zu Chronologie-Einträgen.
ALTER TABLE `InvestigationEntry` ADD COLUMN `discordMessageId` VARCHAR(32) NULL;
CREATE UNIQUE INDEX `InvestigationEntry_discordMessageId_key` ON `InvestigationEntry`(`discordMessageId`);
