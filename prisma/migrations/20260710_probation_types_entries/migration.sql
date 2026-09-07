ALTER TABLE `Probation`
    DROP INDEX `Probation_officerId_key`;

ALTER TABLE `Probation`
    ADD COLUMN `type` ENUM('ROOKIE', 'SERGEANT_SUPERVISOR', 'LEADERSHIP', 'CHIEF') NOT NULL DEFAULT 'ROOKIE';

CREATE INDEX `Probation_officerId_startsAt_idx` ON `Probation`(`officerId`, `startsAt`);
CREATE INDEX `Probation_type_status_idx` ON `Probation`(`type`, `status`);

CREATE TABLE `ProbationEntry` (
    `id` VARCHAR(191) NOT NULL,
    `probationId` VARCHAR(191) NOT NULL,
    `rating` ENUM('POSITIVE', 'NEGATIVE') NOT NULL,
    `comment` TEXT NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProbationEntry_probationId_createdAt_idx`(`probationId`, `createdAt`),
    INDEX `ProbationEntry_createdById_createdAt_idx`(`createdById`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProbationEntry`
    ADD CONSTRAINT `ProbationEntry_probationId_fkey`
    FOREIGN KEY (`probationId`) REFERENCES `Probation`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProbationEntry`
    ADD CONSTRAINT `ProbationEntry_createdById_fkey`
    FOREIGN KEY (`createdById`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
