# Interne Lizenzen – Design

Stand: 25.10.2026 · Grundlage: Konzept „Lizenzen Intern“ von Dr. iur. Nova DeVil

## Wozu

Im FIB sollen bestimmte Befugnisse (Fahren, PDW, Akten bearbeiten, Inhaftierung,
MK2/50er, VF/EL, Betreten von SG/PD/MD-Gelände …) an eine interne Lizenz gebunden
sein. Wer sich daneben benimmt oder Beschwerden auslöst, verliert die Lizenz und darf
die Tätigkeit nicht mehr (oder nur mit Partner) ausüben – bis er sie nach einer
Sperrfrist über erneute Ausbildung/Prüfung zurückbekommt. Ziel: Qualität, Lernen
durch Beobachtung/Zusammenarbeit, und Fehler vermeiden, die dem FIB ethisch oder
rechtlich schaden.

Das Dashboard soll das verwalten: wer welche Lizenz hat, wer sie wann und warum
entzogen hat, ab wann sie wieder erlangt werden kann.

## Ziele

- Lizenzen pro Agent **von Hand** erteilen und entziehen (keine Automatik).
- Eigener Bereich auf der **Agents-Seite** (Agent-Akte), mit **eigener Berechtigung**.
- Entzug mit Pflicht-Begründung, optional mit einer Sanktion verknüpft.
- Sperrfrist je Lizenz: Nach einem Entzug ist sichtbar, ab wann sie wieder erteilt
  werden darf.
- Erteilung **und** Entzug werden im Discord gepostet (wie die bisherigen
  Personalakte-Meldungen).
- Nachvollziehbar: Jede Änderung mit Person, Zeit und Grund – in der Historie der
  Lizenz und in der Timeline des Agents.
- Lizenzarten sind erweiterbar, ohne Code zu ändern (Konzept: „können je nach
  Notwendigkeit erweitert werden“).

## Nicht-Ziele

- Keine automatische Vergabe (nicht bei Einstellung, nicht nach Ausbildung oder
  Probezeit, nicht nach Ablauf der Sperrfrist).
- Keine Prüfungs-/Ausbildungsabwicklung im Lizenzsystem selbst – dass die Fahrt mit
  der Academy oder die erneute GA stattgefunden hat, entscheidet der Mensch, der die
  Lizenz wieder erteilt.
- Keine Geldstrafen (der Sanktionskatalog kennt keine).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Lizenzen lassen sich ohne Begründung entziehen oder ohne Spur ändern.
- Eine entzogene Lizenz kann vor Ablauf der Sperrfrist wieder erteilt werden, ohne
  dass es jemand bewusst übersteuert.
- Wer die Berechtigung nicht hat, kann Lizenzen ändern.

## Festgelegt im Gespräch

- **Ort:** als Bereich der Agent-Akte (`/agents/[id]`), die Reiter-Leiste dort hat
  schon „Profil“, „Dienst & Abwesenheit“, „Ausbildung & Laufbahn“,
  „Dokumente & Notizen“, „Verwaltung“.
- **Berechtigung:** neue Permission, eigens für Lizenzen.
- **Vergabe:** nur manuell.
- **Discord:** Erteilung und Entzug werden gepostet.

## Bestand, an den das andockt

- Agents: `prisma/schema.prisma` → `Agent`; Akte `src/app/(dashboard)/agents/[id]/page.tsx`
  (Reiter über `TabBar`).
- Vorbild für „Liste pflegbar + pro Agent Status“: Ausbildungen – `Training`
  (Admin-Seite `src/app/(dashboard)/admin/trainings`), `AgentTraining`,
  API `src/app/api/agents/[id]/trainings/route.ts`.
- Berechtigungen: `src/lib/permissions.ts` (`PERMISSIONS`, `PERMISSION_LABELS`),
  geprüft mit `requireAuth(roles, permissions)`; im Client `hasPermission`.
- Discord-Meldungen: `queueDiscordHrEvent` mit `EVENT_META` in
  `src/lib/discord/discord-integration.ts` (Typen `training`, `sanction`, …).
- Protokoll: `createAuditLog` (`src/lib/audit/audit.ts`), Timeline der Akte
  (`/api/agents/[id]/timeline`).
- Sanktionen: `Sanction` (für die optionale Verknüpfung beim Entzug).

## Lizenzarten zum Start

Pflegbar wie Ausbildungen (Name, Kurzbeschreibung, Sperrfrist in Tagen,
Reihenfolge, aktiv/inaktiv). Startbestand aus dem Konzept:

| Lizenz | Beschreibung (Kurzfassung aus dem Konzept) | Sperrfrist |
|---|---|---|
| Fahrlizenz | Führen von Dienstfahrzeugen nach StVO; wieder nach Fahrt mit der Academy | 7 Tage |
| PDW | Nutzung der PDW nach Freigabe der Leaderschaft | – |
| PDW+ | PDW-Nutzung ohne anwesende Leader; für vertrauenswürdige Agents | – |
| Akten | Bearbeiten von Akten nach GA; wieder nach erneuter GA | – |
| Inhaft | Inhaftierungen nach GA; wieder wie Akten | – |
| MK2/50er | ab Special Agent I nach Probezeit; wieder auf Anfrage bei der Academy | 14 Tage |
| VF | Verhandlungsführung; wieder nach erneuter Ausbildung, mit positiver interner Akte | 7 Tage |
| EL | Einsatzleitung; wieder wie VF | 7 Tage |
| SG | Betreten des SG-Geländes ohne Aufsicht | – |
| PD | Betreten des PD-Geländes ohne Aufsicht | – |
| MD | Betreten des MD-Geländes ohne Aufsicht | – |

„–“ = keine Sperrfrist im Konzept genannt.

## Verhalten

**Status je Agent und Lizenz:** *nie erteilt*, *erteilt*, *entzogen* (mit „wieder
möglich ab <Datum>“, solange die Sperrfrist läuft; danach „wieder erteilbar“).

**Erteilen:** Person mit Berechtigung erteilt, optional mit Notiz (z. B. „Fahrt mit
Academy bestanden“). Läuft noch eine Sperrfrist, wird das blockiert – außer die
Person übersteuert bewusst (mit Begründung); das wird vermerkt.

**Entziehen:** Begründung ist Pflicht. Optional eine bestehende Sanktion des Agents
verknüpfen. Die Sperrfrist startet mit dem Entzug (Wert der Lizenzart zum Zeitpunkt
des Entzugs).

**Historie:** Jede Erteilung/jeder Entzug bleibt als Eintrag erhalten (wer, wann,
Grund/Notiz, Sanktion, Übersteuerung). Erscheint in der Lizenz-Ansicht und in der
Timeline der Akte; Audit-Log-Eintrag wie bei anderen Personaländerungen.

**Discord:** Neuer HR-Ereignistyp für Lizenzen (Erteilung und Entzug), im gleichen
Stil und Kanal wie die bestehenden Personalakte-Meldungen; beim Entzug mit Grund
und Sperrfrist.

**Ansehen/Ändern:** Ansehen darf, wer die Agent-Akte sehen darf (`agents:view`).
Ändern nur mit der neuen Permission (Vorschlag: `licenses:manage`, Label
„Lizenzen erteilen und entziehen“). Lizenzarten pflegen: Vorschlag ebenfalls
`licenses:manage` oder die bestehende Admin-Logik wie bei `trainings:manage`.

## Dem Builder überlassen

- Genaues Datenmodell (z. B. `License` + `AgentLicense` + Ereignis-Tabelle) und
  API-Form, angelehnt an Ausbildungen.
- Ob die Lizenzen ein eigener Reiter in der Akte werden oder in „Verwaltung“ /
  „Ausbildung & Laufbahn“ einziehen – Hauptsache gut auffindbar.
- Layout der Ansicht und der Dialoge im bestehenden Stil der Akte.
- Optionale Übersicht auf der Agents-Liste (Filter/Spalte „fehlende Lizenz“) –
  nett, aber kein Muss.

## Rahmenbedingungen

- Die lokale `.env` zeigt auf die **Produktions-Datenbank** und den echten Bot:
  Migrationen und schreibende Tests nur nach ausdrücklicher Rückfrage beim Nutzer.
- Nichts committen oder pushen – das macht der Nutzer selbst.
- Next.js-Version mit Abweichungen: vor dem Code die Guides in
  `node_modules/next/dist/docs/` lesen (AGENTS.md).
