ALTER TABLE `Sanction`
  ADD COLUMN `measureType` VARCHAR(191) NOT NULL DEFAULT 'FINE',
  ADD COLUMN `sgRounds` INTEGER NULL;

CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog`(`createdAt`);
