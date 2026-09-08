-- CreateTable
CREATE TABLE `RecordShare` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RecordShare_tokenHash_key`(`tokenHash`),
    INDEX `RecordShare_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecordShareItem` (
    `id` VARCHAR(191) NOT NULL,
    `shareId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `classifiedAtGrant` BOOLEAN NOT NULL DEFAULT false,

    INDEX `RecordShareItem_kind_recordId_idx`(`kind`, `recordId`),
    UNIQUE INDEX `RecordShareItem_shareId_kind_recordId_key`(`shareId`, `kind`, `recordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecordShare` ADD CONSTRAINT `RecordShare_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RecordShareItem` ADD CONSTRAINT `RecordShareItem_shareId_fkey` FOREIGN KEY (`shareId`) REFERENCES `RecordShare`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
