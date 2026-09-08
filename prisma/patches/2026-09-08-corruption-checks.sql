-- CreateTable
CREATE TABLE `PublicOfficial` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `agency` VARCHAR(150) NOT NULL,
    `badgeNumber` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PublicOfficial_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `PublicOfficial_agency_idx`(`agency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorruptionCheck` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `officialId` INTEGER NOT NULL,
    `conductedAt` DATETIME(3) NOT NULL,
    `result` VARCHAR(20) NOT NULL,
    `findings` LONGTEXT NOT NULL,
    `location` VARCHAR(200) NULL,
    `notes` LONGTEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CorruptionCheck_requestId_key`(`requestId`),
    INDEX `CorruptionCheck_officialId_conductedAt_idx`(`officialId`, `conductedAt`),
    INDEX `CorruptionCheck_conductedAt_idx`(`conductedAt`),
    INDEX `CorruptionCheck_result_conductedAt_idx`(`result`, `conductedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorruptionCheckAgent` (
    `id` VARCHAR(191) NOT NULL,
    `checkId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(191) NULL,
    `name` VARCHAR(220) NOT NULL,
    `badgeNumber` VARCHAR(100) NOT NULL,

    INDEX `CorruptionCheckAgent_agentId_idx`(`agentId`),
    UNIQUE INDEX `CorruptionCheckAgent_checkId_agentId_key`(`checkId`, `agentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CorruptionCheck` ADD CONSTRAINT `CorruptionCheck_officialId_fkey` FOREIGN KEY (`officialId`) REFERENCES `PublicOfficial`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorruptionCheck` ADD CONSTRAINT `CorruptionCheck_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorruptionCheckAgent` ADD CONSTRAINT `CorruptionCheckAgent_checkId_fkey` FOREIGN KEY (`checkId`) REFERENCES `CorruptionCheck`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorruptionCheckAgent` ADD CONSTRAINT `CorruptionCheckAgent_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
