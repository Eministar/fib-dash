-- Bestehende Units werden ausschließlich gruppiert und mit sauberer Standard-Sortierung versehen.
-- Es werden keine Units, Officer-Zuweisungen oder direkten Benutzerzuweisungen gelöscht.
-- INSERT IGNORE macht die Migration bei einem erneuten Ausführen idempotent.
INSERT IGNORE INTO `UnitGroup`
  (`id`, `key`, `name`, `description`, `color`, `icon`, `sortOrder`, `active`, `showInNavigation`, `modules`, `permissions`, `createdAt`, `updatedAt`)
VALUES
  (UUID(), 'ACADEMY', 'Academy', 'Recruitment, Training und Ausbilder-Ränge.', '#d4af37', 'graduation-cap', 10, true, true, JSON_OBJECT('academy', 'manage'), JSON_ARRAY('academy:view', 'academy:manage', 'academy-tests:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'HUMAN_RESOURCES', 'Human Resources', 'HR-Hauptunit und alle HR-Ränge.', '#7c3aed', 'briefcase', 20, true, true, JSON_OBJECT('hr', 'manage'), JSON_ARRAY('hr:view', 'hr:manage', 'hr-tests:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'PRESS', 'Pressesprecher', 'Öffentlichkeitsarbeit und Pressemitteilungen.', '#f59e0b', 'newspaper', 30, true, true, JSON_OBJECT('press', 'manage'), JSON_ARRAY('press:view', 'press:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'SRU', 'Special Response Unit', 'Taktische Einsatz- und Spezialaufgaben.', '#dc2626', 'shield', 40, true, true, JSON_OBJECT('sru', 'manage'), JSON_ARRAY('sru:view', 'sru:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'AIR_SUPPORT', 'Air-Support Division', 'Luftunterstützung und Flugdienst.', '#38bdf8', 'plane', 50, true, true, JSON_OBJECT('air_support', 'manage'), JSON_ARRAY('air-support:view', 'air-support:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'DETECTIVE', 'Detective Unit', 'Ermittlungen und Fallbearbeitung.', '#a78bfa', 'fingerprint', 60, true, true, JSON_OBJECT('detective', 'manage'), JSON_ARRAY('detective:view', 'detective:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'INTERNAL_AFFAIRS', 'Internal Affairs', 'Interne Ermittlungen und Durchsuchungsakten.', '#0ea5e9', 'search', 70, true, true, JSON_OBJECT('internal_affairs', 'manage'), JSON_ARRAY('internal-affairs:view', 'internal-affairs:manage'), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  (UUID(), 'RECHTSVERTRETUNG', 'Rechtsvertretung', 'Rechtliche Vertretung und Beratung.', '#64748b', 'scale', 80, true, false, JSON_OBJECT(), JSON_ARRAY(), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- HR: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'HUMAN_RESOURCES'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'HR_LEITUNG' THEN 10
      WHEN u.`key` = 'HR_STV_LEITUNG' THEN 20
      WHEN u.`key` = 'HR_SUPERVISOR' THEN 30
      WHEN u.`key` = 'SENIOR_HR_OPERATOR' THEN 40
      WHEN u.`key` = 'HR_OFFICER' THEN 50
      WHEN u.`key` = 'HR_TRAINEE' THEN 60
      WHEN u.`key` = 'HUMAN_RESOURCES' THEN 70
      WHEN u.`key` = 'HR' THEN 80
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('HUMAN_RESOURCES', 'HR', 'HR_LEITUNG', 'HR_STV_LEITUNG', 'HR_SUPERVISOR', 'SENIOR_HR_OPERATOR', 'HR_OFFICER', 'HR_TRAINEE');

-- Academy: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'ACADEMY'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'ACADEMY_LEITUNG' THEN 10
      WHEN u.`key` = 'ACADEMY_STV_LEITUNG' THEN 20
      WHEN u.`key` = 'RECRUITMENT_TRAINING_SENIOR_AUSBILDER' THEN 30
      WHEN u.`key` = 'ACADEMY_AUSBILDER' THEN 40
      WHEN u.`key` = 'RECRUITMENT_TRAINING_MENTOR' THEN 50
      WHEN u.`key` = 'ACADEMY_TEST_AUSBILDER' THEN 60
      WHEN u.`key` = 'ACADEMY' THEN 70
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('ACADEMY', 'ACADEMY_LEITUNG', 'ACADEMY_STV_LEITUNG', 'RECRUITMENT_TRAINING_SENIOR_AUSBILDER', 'ACADEMY_AUSBILDER', 'RECRUITMENT_TRAINING_MENTOR', 'ACADEMY_TEST_AUSBILDER');

-- SRU: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'SRU'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'S_R_U_LEITUNG' THEN 10
      WHEN u.`key` = 'S_R_U_STV_LEITUNG' THEN 20
      WHEN u.`key` = 'S_R_U_SENIOR_OPERATOR' THEN 30
      WHEN u.`key` = 'S_R_U_OPERATOR' THEN 40
      WHEN u.`key` = 'S_R_U_TRAINEE' THEN 50
      WHEN u.`key` = 'S_R_U_TEAM_ALPHA' THEN 60
      WHEN u.`key` = 'METRO_TEAM_BETA' THEN 70
      WHEN u.`key` = 'METRO_TEAM_GAMMA' THEN 80
      WHEN u.`key` = 'SRU' THEN 90
      WHEN u.`key` = 'S_R_U' THEN 100
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('SRU', 'S_R_U', 'S_R_U_LEITUNG', 'S_R_U_STV_LEITUNG', 'S_R_U_SENIOR_OPERATOR', 'S_R_U_OPERATOR', 'S_R_U_TRAINEE', 'S_R_U_TEAM_ALPHA', 'METRO_TEAM_BETA', 'METRO_TEAM_GAMMA');

-- Air Support: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'AIR_SUPPORT'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'AIR_SUPPORT_DIVISION_LEITUNG' THEN 10
      WHEN u.`key` = 'AIR_SUPPORT_DIVISION_MEMBER' THEN 20
      WHEN u.`key` = 'AIR_SUPPORT' THEN 30
      WHEN u.`key` = 'AIR_SUPPORT_DIVISION' THEN 40
      WHEN u.`key` = 'TEST_AIR_SUPPORT_DIVISION' THEN 50
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('AIR_SUPPORT', 'AIR_SUPPORT_DIVISION', 'AIR_SUPPORT_DIVISION_LEITUNG', 'AIR_SUPPORT_DIVISION_MEMBER', 'TEST_AIR_SUPPORT_DIVISION');

-- Detective: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'DETECTIVE'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'DETECTIVE_LEITUNG' THEN 10
      WHEN u.`key` = 'DETECTIVE_STV_LEITUNG' THEN 20
      WHEN u.`key` = 'DETECTIVE_OFFICER' THEN 30
      WHEN u.`key` = 'DETECTIVE_TRAINEE' THEN 40
      WHEN u.`key` = 'DETECTIVE' THEN 50
      WHEN u.`key` = 'DETECTIVE_UNIT' THEN 60
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('DETECTIVE', 'DETECTIVE_UNIT', 'DETECTIVE_LEITUNG', 'DETECTIVE_STV_LEITUNG', 'DETECTIVE_OFFICER', 'DETECTIVE_TRAINEE');

-- Press: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'PRESS'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'PRESSESPRECHER' THEN 10
      WHEN u.`key` = 'SOCIAL_MEDIA' THEN 20
      WHEN u.`key` = 'STREAMER' THEN 30
      WHEN u.`key` = 'PRESS' THEN 40
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('PRESS', 'PRESSESPRECHER', 'STREAMER', 'SOCIAL_MEDIA');

-- Internal Affairs: Zuordnung und hierarchische Sortierung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'INTERNAL_AFFAIRS'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE
      WHEN u.`sortOrder` > 0 THEN u.`sortOrder`
      WHEN u.`key` = 'INTERNAL_AFFAIRS_LEITUNG' THEN 10
      WHEN u.`key` = 'INTERNAL_AFFAIRS_STV_LEITUNG' THEN 20
      WHEN u.`key` = 'INTERNAL_AFFAIRS_OPERATOR' THEN 30
      WHEN u.`key` = 'INTERNAL_AFFAIRS_JUNIOR_AGENT' THEN 40
      WHEN u.`key` = 'INTERNAL_AFFAIRS' THEN 50
      ELSE u.`sortOrder`
    END
WHERE u.`key` IN ('INTERNAL_AFFAIRS', 'INTERNAL_AFFAIRS_JUNIOR_AGENT', 'INTERNAL_AFFAIRS_OPERATOR', 'INTERNAL_AFFAIRS_LEITUNG', 'INTERNAL_AFFAIRS_STV_LEITUNG');

-- Rechtsvertretung
UPDATE `Unit` u
JOIN `UnitGroup` g ON g.`key` = 'RECHTSVERTRETUNG'
SET u.`groupId` = g.`id`,
    u.`sortOrder` = CASE WHEN u.`sortOrder` > 0 THEN u.`sortOrder` ELSE 10 END
WHERE u.`key` = 'RECHTSVERTRETUNG';

-- Leitungseinheiten
UPDATE `Unit`
SET `isLeadership` = true
WHERE `groupId` IS NOT NULL
  AND `key` IN (
    'HR_LEITUNG', 'HR_STV_LEITUNG', 'HR_SUPERVISOR',
    'ACADEMY_LEITUNG', 'ACADEMY_STV_LEITUNG',
    'S_R_U_LEITUNG', 'S_R_U_STV_LEITUNG',
    'AIR_SUPPORT_DIVISION_LEITUNG',
    'DETECTIVE_LEITUNG', 'DETECTIVE_STV_LEITUNG',
    'INTERNAL_AFFAIRS_LEITUNG', 'INTERNAL_AFFAIRS_STV_LEITUNG'
  );
