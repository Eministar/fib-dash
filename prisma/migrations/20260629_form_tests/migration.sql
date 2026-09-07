CREATE TABLE `FormTest` (
    `id` VARCHAR(191) NOT NULL,
    `module` ENUM('ACADEMY', 'HR', 'SRU', 'AIR_SUPPORT', 'DETECTIVE') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `shareToken` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FormTest_shareToken_key`(`shareToken`),
    INDEX `FormTest_module_status_updatedAt_idx`(`module`, `status`, `updatedAt`),
    INDEX `FormTest_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FormQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `type` ENUM('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE') NOT NULL,
    `title` TEXT NOT NULL,
    `description` TEXT NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `options` JSON NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FormQuestion_testId_sortOrder_idx`(`testId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FormResponse` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `respondentId` VARCHAR(191) NULL,
    `respondentName` VARCHAR(191) NOT NULL,
    `score` INTEGER NULL,
    `maxScore` INTEGER NOT NULL DEFAULT 0,
    `reviewNote` TEXT NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FormResponse_testId_respondentId_key`(`testId`, `respondentId`),
    INDEX `FormResponse_testId_submittedAt_idx`(`testId`, `submittedAt`),
    INDEX `FormResponse_respondentId_submittedAt_idx`(`respondentId`, `submittedAt`),
    INDEX `FormResponse_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `FormAnswer` (
    `id` VARCHAR(191) NOT NULL,
    `responseId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `FormAnswer_responseId_questionId_key`(`responseId`, `questionId`),
    INDEX `FormAnswer_questionId_idx`(`questionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FormTest`
    ADD CONSTRAINT `FormTest_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `FormQuestion`
    ADD CONSTRAINT `FormQuestion_testId_fkey`
    FOREIGN KEY (`testId`) REFERENCES `FormTest`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FormResponse`
    ADD CONSTRAINT `FormResponse_testId_fkey`
    FOREIGN KEY (`testId`) REFERENCES `FormTest`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FormResponse`
    ADD CONSTRAINT `FormResponse_respondentId_fkey`
    FOREIGN KEY (`respondentId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `FormResponse`
    ADD CONSTRAINT `FormResponse_reviewedById_fkey`
    FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `FormAnswer`
    ADD CONSTRAINT `FormAnswer_responseId_fkey`
    FOREIGN KEY (`responseId`) REFERENCES `FormResponse`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FormAnswer`
    ADD CONSTRAINT `FormAnswer_questionId_fkey`
    FOREIGN KEY (`questionId`) REFERENCES `FormQuestion`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
