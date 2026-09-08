-- AlterTable
ALTER TABLE `BodycamClip` ADD COLUMN `compressedAt` DATETIME(3) NULL,
    ADD COLUMN `compressionError` VARCHAR(300) NULL,
    ADD COLUMN `compressionOutput` VARCHAR(80) NULL,
    ADD COLUMN `compressionSource` VARCHAR(80) NULL,
    ADD COLUMN `compressionStartedAt` DATETIME(3) NULL,
    ADD COLUMN `compressionStatus` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `originalSizeBytes` BIGINT NULL;

-- CreateTable
CREATE TABLE `InvestigationPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(30) NOT NULL,
    `messageId` VARCHAR(30) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `filename` VARCHAR(80) NOT NULL,
    `mimeType` VARCHAR(80) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InvestigationPhoto_sourceKey_key`(`sourceKey`),
    UNIQUE INDEX `InvestigationPhoto_filename_key`(`filename`),
    INDEX `InvestigationPhoto_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Dossier` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'COLLECTION',
    `description` TEXT NULL,
    `address` VARCHAR(300) NULL,
    `photoId` VARCHAR(191) NULL,
    `parentId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Dossier_parentId_kind_idx`(`parentId`, `kind`),
    INDEX `Dossier_kind_updatedAt_idx`(`kind`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_DossierPersons` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_DossierPersons_AB_unique`(`A`, `B`),
    INDEX `_DossierPersons_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_DossierInvestigations` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_DossierInvestigations_AB_unique`(`A`, `B`),
    INDEX `_DossierInvestigations_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `BodycamClip_compressionStatus_createdAt_idx` ON `BodycamClip`(`compressionStatus`, `createdAt`);

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_photoId_fkey` FOREIGN KEY (`photoId`) REFERENCES `InvestigationPhoto`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Dossier`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Dossier` ADD CONSTRAINT `Dossier_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DossierPersons` ADD CONSTRAINT `_DossierPersons_A_fkey` FOREIGN KEY (`A`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DossierPersons` ADD CONSTRAINT `_DossierPersons_B_fkey` FOREIGN KEY (`B`) REFERENCES `Person`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DossierInvestigations` ADD CONSTRAINT `_DossierInvestigations_A_fkey` FOREIGN KEY (`A`) REFERENCES `Dossier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_DossierInvestigations` ADD CONSTRAINT `_DossierInvestigations_B_fkey` FOREIGN KEY (`B`) REFERENCES `Investigation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
