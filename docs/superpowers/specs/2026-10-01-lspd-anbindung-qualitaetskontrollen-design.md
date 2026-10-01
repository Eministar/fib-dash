# LSPD-Anbindung und Qualitätskontrollen – Design

Stand 2026-10-01. Vom Nutzer im Chat freigegeben: eigener Endpunkt + Secret, Stammdaten + Laufbahn, Freigabe per Link („wer den Link hat, sieht es“), Beamtenauswahl an allen Stellen mit Beamten.

## A – lspd-hr: externe API
`GET /api/external/officers?q=&status=&limit=` und `GET /api/external/officers/{id}`; Header `x-api-secret` gegen `FIB_API_SECRET` (≥ 24 Zeichen, Vergleich über SHA-256 + `timingSafeEqual`); ohne Secret 503. Nur ausgewählte Felder (keine Notizen, Flags, Bearbeiter), `no-store`.

## B – fib-dash: Anbindung
`LSPD_HR_API_URL`, `LSPD_HR_API_SECRET`. Serverseitiger Client (`server-only`, 8 s Timeout, 60 s Cache), Proxy-Routen `/api/lspd/officers[/id]` für angemeldete Nutzer, wiederverwendbare `LspdOfficerPicker` und `LspdOfficerFilePanel`.

## C – Korruptionskontrollen
`PublicOfficial.lspdOfficerId` (unique, nullable). Dritter Weg im Formular; das Panel wird vor der serialisierbaren Transaktion abgefragt; gleichzeitige Erstanlage wird über den Unique-Index + einmaligen Retry aufgelöst.

## D – Qualitätskontrollen
`QualityCheck` (Nummer QK-, Officer-Snapshot, RUNNING/COMPLETED, Bewertung, Fazit), `QualityCheckEntry` (POSITIVE/NEGATIVE/NOTE, unveränderlich, Korrektur per `correctsId`, max. eine Korrektur je Eintrag), `QualityShare` (Scope CHECK/OFFICER/ALL, Token-Hash, Ablauf, Deaktivieren, Ersetzen, optional Laufbahn). Schreibende Vorgänge sperren die Kontrolle (`FOR UPDATE`). Öffentliche Ansicht nur abgeschlossene Kontrollen, ohne Prüfernamen. Rechte `quality-checks:view` / `quality-checks:manage`.
