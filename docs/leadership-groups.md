# Ermittlungsgruppen

Unter **Leadership → Ermittlungsgruppen** können berechtigte Nutzer benannte Gruppen erstellen und bearbeiten. Mitglieder werden über ihre Dashboard-Konten mit Discord-Verknüpfung ausgewählt. Familien stammen aus den vorhandenen Familienakten (`Dossier.kind = FAMILY`). Jede zugewiesene Familie benötigt ein oder zwei unterschiedliche Gruppenmitglieder als Leitung; dieselbe Person kann mehrere Familien leiten.

## Einrichtung

1. Das additive Prisma-Schema mit dem üblichen, gesicherten Projektworkflow anwenden: `npm run db:push`. Anschließend `npm run db:generate` und Anwendung neu starten.
2. Der Leadership-Benutzergruppe unter Administration → Benutzergruppen das Recht **Leadership – Ermittlungsgruppen verwalten (vertraulich)** (`leadership-groups:manage`) geben. Bestehende Administratoren mit Vollzugriff erhalten dieses Recht automatisch. Andere Unit-Leitungsrechte gewähren keinen Zugriff.
3. Vorhandenen Discord-Bot und Server konfigurieren (`DISCORD_BOT_TOKEN` / `FIB_DISCORD_BOT_TOKEN`, bestehende Server-Einstellung). Der Bot benötigt Kanalverwaltung, Rechteverwaltung, Kanalansicht, Nachrichten senden und Nachrichtenverlauf lesen. Mitglieder müssen dem Server bereits angehören.

## Vertraulichkeit

Die API filtert normale Nutzer serverseitig auf ihre eigenen Mitgliedschaften. Nur Nutzer mit Verwaltungsrecht erhalten die gesamte Gruppenliste und Auswahlkataloge. Es gibt keine Rückverknüpfungen zu Agenten-, Nutzer- oder Familienakten, keine allgemeinen Audit-Einträge, keine Change-History-Snapshots und keine Meldungen im zentralen Discord-Protokoll. Gruppenänderungen werden separat und ausschließlich für die Nachrichtenzustellung gespeichert.

Discord-Kanäle werden mit verweigerter Ansicht für `@everyone` und individuellen Freigaben für Bot und Mitglieder erstellt. Bei jeder Synchronisierung wird die gesamte Freigabeliste ersetzt. Es werden keine sichtbaren Mitgliedschaftsrollen erstellt. **Discord-Serverinhaber und Administratoren können Kanalbeschränkungen umgehen; Discord-Audit-Log-Berechtigungen können administrative Kanaländerungen offenlegen.** Diese Discord-Rechte dürfen gewöhnliche Agents nicht besitzen, wenn die Zugehörigkeit geheim bleiben soll. Der Kanalzugang erweitert nicht die Berechtigungen für Ermittlungsakten im Dashboard.

## Synchronisierung

Speichern übernimmt den gewünschten Zustand atomar mit Versionsprüfung und versucht direkt den Discord-Abgleich. Ein Worker prüft alle 30 Sekunden fällige Gruppen, wiederholt Fehler und gleicht erfolgreiche Gruppen nach fünf Minuten erneut ab (auch nach Kontolöschung oder Änderung einer Discord-ID). Prozessübergreifende Datenbank-Leases verhindern gleichzeitige Änderungen und Abgleiche. Es werden maximal fünf vorgemerkte Nachrichten je Durchlauf zugestellt; weitere folgen automatisch. Die private Kanalmarkierung ermöglicht die Wiederaufnahme nach einem verlorenen Create-Response.

Bei Discord-Ausfall bleibt der Dashboard-Zugriff sofort auf den neuen Mitgliederstand beschränkt. Discord-Rechte können bis zum erfolgreichen Abgleich veraltet bleiben; die Oberfläche zeigt dies ausdrücklich an. Nachrichten werden mit stabiler Nonce zugestellt; nach längeren Ausfällen kann Discord bei einem verlorenen Response und erneutem Versand eine Nachricht doppelt zustellen.

## Prüfung

`npx tsx --test tests/leadership-groups.test.ts`

`npx tsc --noEmit`

Für die Abnahme mit einem Testserver: Gruppe mit zwei Konten und vier Familien erstellen, Fremdkonto über API prüfen, Mitglied entfernen und Kanalzugriff überprüfen, Bot-Rechte temporär entziehen und automatische Wiederaufnahme prüfen. Diese Aktionen benötigen eine erreichbare Testdatenbank und einen konfigurierten Testbot.
