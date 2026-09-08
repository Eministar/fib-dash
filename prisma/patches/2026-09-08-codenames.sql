-- CreateTable
CREATE TABLE `Codename` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `category` VARCHAR(40) NULL,
    `retired` BOOLEAN NOT NULL DEFAULT false,
    `retiredReason` VARCHAR(200) NULL,
    `currentAgentId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Codename_name_key`(`name`),
    UNIQUE INDEX `Codename_currentAgentId_key`(`currentAgentId`),
    INDEX `Codename_category_idx`(`category`),
    INDEX `Codename_retired_idx`(`retired`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CodenameAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `codenameId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(191) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(40) NULL,
    `note` TEXT NULL,
    `assignedById` VARCHAR(191) NULL,
    `releasedById` VARCHAR(191) NULL,

    INDEX `CodenameAssignment_codenameId_assignedAt_idx`(`codenameId`, `assignedAt`),
    INDEX `CodenameAssignment_agentId_assignedAt_idx`(`agentId`, `assignedAt`),
    INDEX `CodenameAssignment_releasedAt_idx`(`releasedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Codename` ADD CONSTRAINT `Codename_currentAgentId_fkey` FOREIGN KEY (`currentAgentId`) REFERENCES `Agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Codename` ADD CONSTRAINT `Codename_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodenameAssignment` ADD CONSTRAINT `CodenameAssignment_codenameId_fkey` FOREIGN KEY (`codenameId`) REFERENCES `Codename`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodenameAssignment` ADD CONSTRAINT `CodenameAssignment_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodenameAssignment` ADD CONSTRAINT `CodenameAssignment_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodenameAssignment` ADD CONSTRAINT `CodenameAssignment_releasedById_fkey` FOREIGN KEY (`releasedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
