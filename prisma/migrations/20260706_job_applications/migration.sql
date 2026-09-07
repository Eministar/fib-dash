CREATE TABLE `JobApplication` (
    `id` VARCHAR(191) NOT NULL,
    `applicantId` VARCHAR(191) NOT NULL,
    `discordId` VARCHAR(191) NOT NULL,
    `discordUsername` VARCHAR(191) NULL,
    `discordGlobalName` VARCHAR(191) NULL,
    `discordAvatar` VARCHAR(191) NULL,
    `applicantDisplayName` VARCHAR(191) NOT NULL,
    `status` ENUM('SUBMITTED', 'IN_REVIEW', 'HR_INTERVIEW', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    `statusText` VARCHAR(500) NOT NULL DEFAULT 'Bewerbung wurde eingereicht',
    `internalNote` TEXT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JobApplication_applicantId_key`(`applicantId`),
    INDEX `JobApplication_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `JobApplication_submittedAt_idx`(`submittedAt`),
    INDEX `JobApplication_discordId_idx`(`discordId`),
    INDEX `JobApplication_reviewedById_idx`(`reviewedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `JobApplicationAnswer` (
    `id` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NOT NULL,
    `questionId` VARCHAR(191) NOT NULL,
    `questionTitle` TEXT NOT NULL,
    `questionType` ENUM('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'SCALE') NOT NULL,
    `value` JSON NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `JobApplicationAnswer_applicationId_questionId_key`(`applicationId`, `questionId`),
    INDEX `JobApplicationAnswer_applicationId_sortOrder_idx`(`applicationId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `JobApplication`
    ADD CONSTRAINT `JobApplication_applicantId_fkey`
    FOREIGN KEY (`applicantId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `JobApplication`
    ADD CONSTRAINT `JobApplication_reviewedById_fkey`
    FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `JobApplicationAnswer`
    ADD CONSTRAINT `JobApplicationAnswer_applicationId_fkey`
    FOREIGN KEY (`applicationId`) REFERENCES `JobApplication`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
