ALTER TABLE `FormTest`
    ADD COLUMN `kind` ENUM('TEST', 'SURVEY') NOT NULL DEFAULT 'TEST',
    ADD COLUMN `timeLimitMinutes` INTEGER NULL,
    ADD COLUMN `anonymousResponses` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `FormResponse`
    ADD COLUMN `submitterHash` VARCHAR(191) NULL;

CREATE INDEX `FormResponse_testId_submitterHash_idx`
    ON `FormResponse`(`testId`, `submitterHash`);

CREATE INDEX `FormResponse_submitterHash_idx`
    ON `FormResponse`(`submitterHash`);

CREATE TABLE `FormTestSession` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `securityEvents` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FormTestSession_userId_completedAt_expiresAt_idx`(`userId`, `completedAt`, `expiresAt`),
    INDEX `FormTestSession_testId_userId_startedAt_idx`(`testId`, `userId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FormTestSession`
    ADD CONSTRAINT `FormTestSession_testId_fkey`
    FOREIGN KEY (`testId`) REFERENCES `FormTest`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `FormTestSession`
    ADD CONSTRAINT `FormTestSession_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
