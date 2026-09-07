CREATE TABLE `PressRelease` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `content` TEXT NOT NULL,
    `imageUrl` TEXT NULL,
    `imageAlt` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PressRelease_slug_key`(`slug`),
    INDEX `PressRelease_status_publishedAt_idx`(`status`, `publishedAt`),
    INDEX `PressRelease_createdAt_idx`(`createdAt`),
    INDEX `PressRelease_createdById_idx`(`createdById`),
    INDEX `PressRelease_updatedById_idx`(`updatedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PressRelease`
    ADD CONSTRAINT `PressRelease_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PressRelease`
    ADD CONSTRAINT `PressRelease_updatedById_fkey`
    FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
