-- Agent des Monats: Stimmen je Nutzer und Monat.
-- Rein additiv: nur eine neue Tabelle. Alternativ zu `npm run db:push`, nicht beides.
-- CreateTable
CREATE TABLE `AgentOfMonthVote` (
    `id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AgentOfMonthVote_month_voterId_key`(`month`, `voterId`),
    INDEX `AgentOfMonthVote_month_agentId_idx`(`month`, `agentId`),
    INDEX `AgentOfMonthVote_agentId_idx`(`agentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AgentOfMonthVote` ADD CONSTRAINT `AgentOfMonthVote_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AgentOfMonthVote` ADD CONSTRAINT `AgentOfMonthVote_agentId_fkey` FOREIGN KEY (`agentId`) REFERENCES `Agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
