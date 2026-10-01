-- LSPD-Anbindung (Verknüpfung der Beamtenakten) und Qualitätskontrollen.
-- Additiv: neue Tabellen plus eine neue, optionale Spalte an `PublicOfficial`.
-- Setzt 2026-10-01-notifications-custody.sql voraus. Alternativ zu `npm run db:push`, nicht beides.
-- AlterTable
ALTER TABLE `PublicOfficial` ADD COLUMN `lspdOfficerId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `PublicOfficial_lspdOfficerId_key` ON `PublicOfficial`(`lspdOfficerId`);

-- CreateTable
CREATE TABLE `QualityCheck` (
    `id` VARCHAR(191) NOT NULL,
    `number` VARCHAR(24) NOT NULL,
    `lspdOfficerId` VARCHAR(191) NOT NULL,
    `officerName` VARCHAR(220) NOT NULL,
    `officerBadge` VARCHAR(100) NOT NULL,
    `officerRank` VARCHAR(120) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
    `rating` VARCHAR(20) NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `endedAt` DATETIME(3) NULL,
    `location` VARCHAR(200) NULL,
    `summary` TEXT NULL,
    `conductedById` VARCHAR(191) NULL,
    `conductorName` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QualityCheck_number_key`(`number`),
    INDEX `QualityCheck_lspdOfficerId_startedAt_idx`(`lspdOfficerId`, `startedAt`),
    INDEX `QualityCheck_status_startedAt_idx`(`status`, `startedAt`),
    INDEX `QualityCheck_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityCheckEntry` (
    `id` VARCHAR(191) NOT NULL,
    `checkId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `text` TEXT NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `correctsId` VARCHAR(191) NULL,
    `authorId` VARCHAR(191) NULL,
    `authorName` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `QualityCheckEntry_checkId_occurredAt_idx`(`checkId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QualityShare` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `scope` VARCHAR(20) NOT NULL,
    `checkId` VARCHAR(191) NULL,
    `lspdOfficerId` VARCHAR(191) NULL,
    `includeCareer` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `lastAccessAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `QualityShare_tokenHash_key`(`tokenHash`),
    INDEX `QualityShare_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `QualityCheck` ADD CONSTRAINT `QualityCheck_conductedById_fkey` FOREIGN KEY (`conductedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityCheckEntry` ADD CONSTRAINT `QualityCheckEntry_checkId_fkey` FOREIGN KEY (`checkId`) REFERENCES `QualityCheck`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityCheckEntry` ADD CONSTRAINT `QualityCheckEntry_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QualityShare` ADD CONSTRAINT `QualityShare_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
