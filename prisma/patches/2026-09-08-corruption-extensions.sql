-- AlterTable
ALTER TABLE `PublicOfficial` ADD COLUMN `mergedIntoId` INTEGER NULL;

-- AlterTable
ALTER TABLE `CorruptionCheck` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `CorruptionRevision` (
    `id` VARCHAR(191) NOT NULL,
    `checkId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `before` JSON NOT NULL,
    `after` JSON NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `actorName` VARCHAR(220) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CorruptionRevision_checkId_version_key`(`checkId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CorruptionEvidence` (
    `id` VARCHAR(191) NOT NULL,
    `checkId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `filename` VARCHAR(80) NULL,
    `mimeType` VARCHAR(100) NULL,
    `sizeBytes` INTEGER NULL,
    `clipId` VARCHAR(191) NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `uploadedByName` VARCHAR(220) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CorruptionEvidence_filename_key`(`filename`),
    INDEX `CorruptionEvidence_checkId_createdAt_idx`(`checkId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PublicOfficial` ADD CONSTRAINT `PublicOfficial_mergedIntoId_fkey` FOREIGN KEY (`mergedIntoId`) REFERENCES `PublicOfficial`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `CorruptionRevision` ADD CONSTRAINT `CorruptionRevision_checkId_fkey` FOREIGN KEY (`checkId`) REFERENCES `CorruptionCheck`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CorruptionEvidence` ADD CONSTRAINT `CorruptionEvidence_checkId_fkey` FOREIGN KEY (`checkId`) REFERENCES `CorruptionCheck`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
