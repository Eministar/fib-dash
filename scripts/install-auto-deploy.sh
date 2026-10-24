#!/usr/bin/env bash
#
# install-auto-deploy.sh — richtet das automatische Deploy einmalig ein.
# Auf dem Server im App-Ordner als der Benutzer ausführen, unter dem die App läuft:
#
#   bash scripts/install-auto-deploy.sh            # einrichten (oder aktualisieren)
#   bash scripts/install-auto-deploy.sh --remove   # wieder entfernen
#   bash scripts/install-auto-deploy.sh --status   # Eintrag und letzte Protokollzeilen zeigen
#
# Danach prüft der Server jede Minute, ob auf origin/main ein neuer Commit liegt,
# und deployt ihn mit scripts/update.sh. Protokoll: deploy-logs/auto-deploy.log

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="# fib-auto-deploy"

current_crontab() { crontab -l 2>/dev/null | grep -v "$MARKER" || true; }

case "${1:-}" in
  --remove)
    current_crontab | crontab -
    echo "✓ Automatisches Deploy entfernt."
    exit 0 ;;
  --status)
    crontab -l 2>/dev/null | grep "$MARKER" || echo "Nicht eingerichtet."
    echo "--- deploy-logs/auto-deploy.log (letzte Zeilen)"
    tail -n 15 "$APP_DIR/deploy-logs/auto-deploy.log" 2>/dev/null || echo "(noch leer)"
    exit 0 ;;
  "") ;;
  *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
esac

for tool in crontab flock git npm screen; do
  command -v "$tool" >/dev/null 2>&1 || { echo "✗ '$tool' fehlt auf dem Server." >&2; exit 1; }
done

# Cron hat weder Terminal noch SSH-Agent: Der Fetch muss ohne Rückfrage klappen.
if ! (cd "$APP_DIR" && GIT_TERMINAL_PROMPT=0 SSH_AUTH_SOCK= git fetch --quiet origin); then
  echo "✗ 'git fetch' braucht hier eine Eingabe oder einen SSH-Agent." >&2
  echo "  Für Cron muss der Zugriff ohne Rückfrage gehen, z. B. per Deploy-Key ohne Passphrase" >&2
  echo "  oder gespeicherten HTTPS-Zugangsdaten (git config credential.helper store)." >&2
  exit 1
fi

# Cron startet mit minimalem PATH – den aktuellen übernehmen, damit node/npm
# (auch über nvm) gefunden werden.
LINE="* * * * * PATH='$PATH' /usr/bin/env bash '$APP_DIR/scripts/auto-deploy.sh' >/dev/null 2>&1 $MARKER"
{ current_crontab; echo "$LINE"; } | crontab -

echo "✓ Automatisches Deploy eingerichtet: Der Server prüft jede Minute auf neue Commits."
echo "  Protokoll:  tail -f $APP_DIR/deploy-logs/auto-deploy.log"
echo "  Status:     bash scripts/install-auto-deploy.sh --status"
echo "  Entfernen:  bash scripts/install-auto-deploy.sh --remove"
