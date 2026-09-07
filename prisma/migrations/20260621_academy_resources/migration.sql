CREATE TABLE `AcademyResource` (
    `id` VARCHAR(191) NOT NULL,
    `scope` ENUM('GENERAL', 'TRAINING') NOT NULL,
    `type` ENUM('FILE', 'LINK') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `trainingId` VARCHAR(191) NULL,
    `customTrainingName` VARCHAR(191) NULL,
    `url` TEXT NULL,
    `storedFilename` VARCHAR(191) NULL,
    `originalFilename` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `size` INTEGER NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AcademyResource_scope_createdAt_idx`(`scope`, `createdAt`),
    INDEX `AcademyResource_trainingId_createdAt_idx`(`trainingId`, `createdAt`),
    INDEX `AcademyResource_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AcademyResource`
    ADD CONSTRAINT `AcademyResource_trainingId_fkey`
    FOREIGN KEY (`trainingId`) REFERENCES `Training`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AcademyResource`
    ADD CONSTRAINT `AcademyResource_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
