CREATE TABLE `ContractTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `content` TEXT NOT NULL,
    `clauses` JSON NOT NULL,
    `closing` TEXT NULL,
    `fields` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContractTemplate_active_updatedAt_idx`(`active`, `updatedAt`),
    INDEX `ContractTemplate_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Contract` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `officerId` VARCHAR(191) NOT NULL,
    `applicationId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `clauses` JSON NOT NULL,
    `closing` TEXT NULL,
    `fields` JSON NOT NULL,
    `values` JSON NULL,
    `status` ENUM('DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `token` VARCHAR(191) NOT NULL,
    `signerDiscordId` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `sentVia` VARCHAR(191) NULL,
    `sentChannelId` VARCHAR(191) NULL,
    `sentMessageId` VARCHAR(191) NULL,
    `sendCount` INTEGER NOT NULL DEFAULT 0,
    `lastSendError` TEXT NULL,
    `signedAt` DATETIME(3) NULL,
    `signedName` VARCHAR(191) NULL,
    `signedByUserId` VARCHAR(191) NULL,
    `signedIp` VARCHAR(64) NULL,
    `signedUserAgent` VARCHAR(200) NULL,
    `declinedAt` DATETIME(3) NULL,
    `declineReason` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contract_token_key`(`token`),
    INDEX `Contract_officerId_createdAt_idx`(`officerId`, `createdAt`),
    INDEX `Contract_status_updatedAt_idx`(`status`, `updatedAt`),
    INDEX `Contract_applicationId_idx`(`applicationId`),
    INDEX `Contract_templateId_idx`(`templateId`),
    INDEX `Contract_createdById_idx`(`createdById`),
    INDEX `Contract_signedByUserId_idx`(`signedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `JobApplication` ADD COLUMN `officerId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `JobApplication_officerId_key` ON `JobApplication`(`officerId`);

ALTER TABLE `JobApplication`
    ADD CONSTRAINT `JobApplication_officerId_fkey`
    FOREIGN KEY (`officerId`) REFERENCES `Officer`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ContractTemplate`
    ADD CONSTRAINT `ContractTemplate_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Contract`
    ADD CONSTRAINT `Contract_templateId_fkey`
    FOREIGN KEY (`templateId`) REFERENCES `ContractTemplate`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Contract`
    ADD CONSTRAINT `Contract_officerId_fkey`
    FOREIGN KEY (`officerId`) REFERENCES `Officer`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Contract`
    ADD CONSTRAINT `Contract_applicationId_fkey`
    FOREIGN KEY (`applicationId`) REFERENCES `JobApplication`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Contract`
    ADD CONSTRAINT `Contract_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Contract`
    ADD CONSTRAINT `Contract_signedByUserId_fkey`
    FOREIGN KEY (`signedByUserId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
