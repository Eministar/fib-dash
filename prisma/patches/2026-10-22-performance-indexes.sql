-- Indizes für die häufigen Zeitraum-Abfragen (Übersicht, Statistik, Wochenbericht)
-- und den Statusfilter der Agentenliste. Rein additiv, ohne Datenänderung.
-- Alternativ zu `npm run db:push`, nicht beides.

CREATE INDEX `AuditLog_action_createdAt_idx` ON `AuditLog`(`action`, `createdAt`);
CREATE INDEX `PromotionLog_createdAt_idx` ON `PromotionLog`(`createdAt`);
CREATE INDEX `Termination_terminatedAt_idx` ON `Termination`(`terminatedAt`);
CREATE INDEX `Agent_status_idx` ON `Agent`(`status`);
