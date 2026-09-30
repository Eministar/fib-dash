#!/usr/bin/env bash
#
# update.sh — manuelles Server-Update. Einfach auf dem Server im App-Ordner:
#
#   bash scripts/update.sh              # normales Update – nur was sich geändert hat
#   bash scripts/update.sh --force      # alles ausführen (install, Schema, Build, Restart)
#   bash scripts/update.sh --backup     # DB-Backup auch ohne Schema-Änderung
#   bash scripts/update.sh --seed       # zusätzlich Seed (einmalig: importiert bestehende
#                                        #   Ordnungen; ACHTUNG: setzt Gruppen-/Unit-Rechte
#                                        #   auf die Seed-Defaults zurück!)
#   bash scripts/update.sh --no-backup  # DB-Backup nie ausführen
#   bash scripts/update.sh --branch dev # anderen Branch deployen (Default: main)
#
# Erkennt den App-Ordner selbst (Elternverzeichnis dieses Skripts) und ruft dann
# den gemeinsamen Deploy-Ablauf (deploy-server.sh) auf. Der führt nur die
# Schritte aus, die die neuen Commits brauchen:
#   [Backup + db push bei Schema-Änderung] → git reset --hard origin/<branch> →
#   [npm ci bei package*.json-Änderung] → [Seed] → build → Neustart → Health-Check

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -t 2 && "${NO_COLOR:-}" != "1" ]]; then
  C_RESET=$'\033[0m' C_RED=$'\033[31m'
else
  C_RESET='' C_RED=''
fi

RUN_SEED=0
SKIP_BACKUP=0
FORCE_BACKUP=0
FORCE=0
DEPLOY_BRANCH="main"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --seed) RUN_SEED=1; shift ;;
    --no-backup) SKIP_BACKUP=1; shift ;;
    --backup) FORCE_BACKUP=1; shift ;;
    --force) FORCE=1; shift ;;
    --branch) DEPLOY_BRANCH="${2:?--branch braucht einen Wert}"; shift 2 ;;
    -h|--help)
      sed '1d' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done

export APP_DIR RUN_SEED SKIP_BACKUP FORCE_BACKUP FORCE DEPLOY_BRANCH
cd "$APP_DIR"

# Wichtig: deploy-server.sh liegt im Repo und wird von `git reset --hard`
# mitten im Lauf überschrieben. Bash liest Skripte fortlaufend aus der Datei —
# würde die Datei sich darunter ändern, führt das zu Fehlern. Deshalb in eine
# stabile temporäre Kopie ausführen. Die Kopie kommt direkt vom Ziel-Branch,
# damit ein einziger Aufruf bereits die aktuelle Deploy-Logik verwendet.
TMP_DEPLOY="$(mktemp)"
trap 'rm -f "$TMP_DEPLOY"' EXIT
if ! git fetch --quiet origin "$DEPLOY_BRANCH" >/dev/null 2>&1; then
  printf '%s✗%s Remote-Branch %s konnte nicht geladen werden.\n' "$C_RED" "$C_RESET" "$DEPLOY_BRANCH" >&2
  exit 1
fi
if ! git show "origin/$DEPLOY_BRANCH:scripts/deploy-server.sh" > "$TMP_DEPLOY" 2>/dev/null; then
  printf '%s✗%s Deploy-Skript im Ziel-Branch nicht gefunden.\n' "$C_RED" "$C_RESET" >&2
  exit 1
fi

if bash "$TMP_DEPLOY"; then
  status=0
else
  status=$?
fi
rm -f "$TMP_DEPLOY"
exit "$status"
