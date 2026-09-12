# Ermittlungsgruppen

Unter **Leadership → Ermittlungsgruppen** können berechtigte Nutzer benannte Gruppen erstellen, bearbeiten und löschen. Mitglieder werden über ihre Dashboard-Konten mit Discord-Verknüpfung ausgewählt. Familien werden je Gruppe frei eingetippt (ein Name pro Zeile, keine Verknüpfung zu Familienakten). Jede Familie benötigt ein oder zwei unterschiedliche Gruppenmitglieder als Leitung; dieselbe Person kann mehrere Familien leiten.

## Einrichtung

1. Das additive Prisma-Schema mit dem üblichen, gesicherten Projektworkflow anwenden: `npm run db:push`. Anschließend `npm run db:generate` und Anwendung neu starten.
2. Der Leadership-Benutzergruppe unter Administration → Benutzergruppen das Recht **Leadership – Ermittlungsgruppen verwalten (vertraulich)** (`leadership-groups:manage`) geben. Bestehende Administratoren mit Vollzugriff erhalten dieses Recht automatisch. Andere Unit-Leitungsrechte gewähren keinen Zugriff.
3. Vorhandenen Discord-Bot und Server konfigurieren (`DISCORD_BOT_TOKEN` / `FIB_DISCORD_BOT_TOKEN`, bestehende Server-Einstellung). Der Bot benötigt Kanalverwaltung, Rechteverwaltung, Kanalansicht, Nachrichten senden und Nachrichtenverlauf lesen. Mitglieder müssen dem Server bereits angehören.

## Discord-Kanal

Bleibt das Feld **Discord-Kanal-ID** leer, legt das Modul einen eigenen privaten Kanal an und verwaltet ihn vollständig. Wird eine Kanal-ID eingetragen, nutzt die Gruppe diesen bestehenden Textkanal: Name, Thema und Verlauf bleiben unverändert, die **Berechtigungsüberschreibungen werden jedoch vollständig durch die Gruppenfreigabe ersetzt** (`@everyone` gesperrt, Einzelfreigaben für Bot und Mitglieder). Vorher dort vergebene Rollen- und Nutzerrechte gehen damit verloren. Ein Kanal kann nur einer Gruppe zugeordnet sein. Wird die ID später wieder geleert, legt das Modul einen neuen eigenen Kanal an; der zuvor genutzte Kanal bleibt unangetastet.

Nachrichten werden als Embeds zugestellt (Titel je Ereignisart, farbliche Unterscheidung, Zeitstempel, Gruppenname in der Fußzeile): Gruppe erstellt, Gruppe umbenannt, Mitglied hinzugefügt, Mitglied entfernt, Familien & Leitungen aktualisiert, Gruppe aufgelöst.

## Löschen

Beim Löschen wird zunächst ein Abschluss-Embed im Kanal gepostet. Ein selbst angelegter Kanal wird anschließend gelöscht, ein übernommener bestehender Kanal bleibt erhalten und verliert nur alle Mitgliederfreigaben. Der Datenbankeintrag wird in jedem Fall entfernt, auch wenn Discord nicht erreichbar ist — der Dashboard-Zugriff endet sofort; die Oberfläche weist in diesem Fall auf die nötige manuelle Prüfung in Discord hin.

## Vertraulichkeit

Die API filtert normale Nutzer serverseitig auf ihre eigenen Mitgliedschaften. Nur Nutzer mit Verwaltungsrecht erhalten die gesamte Gruppenliste und den Mitgliederkatalog. Es gibt keine Rückverknüpfungen zu Agenten-, Nutzer- oder Familienakten, keine allgemeinen Audit-Einträge, keine Change-History-Snapshots und keine Meldungen im zentralen Discord-Protokoll. Gruppenänderungen werden separat und ausschließlich für die Nachrichtenzustellung gespeichert.

**Discord-Serverinhaber und Administratoren können Kanalbeschränkungen umgehen; Discord-Audit-Log-Berechtigungen können administrative Kanaländerungen offenlegen.** Diese Discord-Rechte dürfen gewöhnliche Agents nicht besitzen, wenn die Zugehörigkeit geheim bleiben soll. Bei einem übernommenen bestehenden Kanal ist zusätzlich zu beachten, dass dessen bisheriger Nachrichtenverlauf für die neuen Mitglieder sichtbar wird. Der Kanalzugang erweitert nicht die Berechtigungen für Ermittlungsakten im Dashboard.

## Synchronisierung

Speichern übernimmt den gewünschten Zustand atomar mit Versionsprüfung und versucht direkt den Discord-Abgleich. Ein Worker prüft alle 30 Sekunden fällige Gruppen, wiederholt Fehler und gleicht erfolgreiche Gruppen nach fünf Minuten erneut ab (auch nach Kontolöschung oder Änderung einer Discord-ID). Prozessübergreifende Datenbank-Leases verhindern gleichzeitige Änderungen und Abgleiche. Es werden maximal fünf vorgemerkte Nachrichten je Durchlauf zugestellt; weitere folgen automatisch. Die private Kanalmarkierung ermöglicht die Wiederaufnahme nach einem verlorenen Create-Response.

Bei Discord-Ausfall bleibt der Dashboard-Zugriff sofort auf den neuen Mitgliederstand beschränkt. Discord-Rechte können bis zum erfolgreichen Abgleich veraltet bleiben; die Oberfläche zeigt dies ausdrücklich an. Nachrichten werden mit stabiler Nonce zugestellt; nach längeren Ausfällen kann Discord bei einem verlorenen Response und erneutem Versand eine Nachricht doppelt zustellen.

## Prüfung

`npx tsx --test tests/leadership-groups.test.ts`

`npx tsc --noEmit`

Für die Abnahme mit einem Testserver: Gruppe mit zwei Konten und vier Familien erstellen, Fremdkonto über API prüfen, Mitglied entfernen und Kanalzugriff überprüfen, bestehenden Kanal per ID übernehmen, Gruppe löschen und Kanalzustand prüfen, Bot-Rechte temporär entziehen und automatische Wiederaufnahme prüfen. Diese Aktionen benötigen eine erreichbare Testdatenbank und einen konfigurierten Testbot.
