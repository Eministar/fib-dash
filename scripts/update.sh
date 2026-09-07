#!/usr/bin/env bash
#
# update.sh — manuelles Server-Update. Einfach auf dem Server im App-Ordner:
#
#   bash scripts/update.sh              # normales Update (pull, Schema, Backfill, Build, Restart)
#   bash scripts/update.sh --seed       # zusätzlich Seed (einmalig: importiert bestehende
#                                        #   Ordnungen; ACHTUNG: setzt Gruppen-/Unit-Rechte
#                                        #   auf die Seed-Defaults zurück!)
#   bash scripts/update.sh --no-backup  # DB-Backup überspringen (schneller/robuster)
#   bash scripts/update.sh --branch dev # anderen Branch deployen (Default: main)
#
# Erkennt den App-Ordner selbst (Elternverzeichnis dieses Skripts) und ruft dann
# den gemeinsamen Deploy-Ablauf (deploy-server.sh) auf. Ablauf dort:
#   DB-Backup → git reset --hard origin/<branch> → npm ci → prisma generate →
#   prisma db push (ohne --accept-data-loss) → Unitgruppen-Status prüfen →
#   [optional Seed] → build → screen FIBPANEL neu starten.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -t 1 && "${NO_COLOR:-}" != "1" ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_CYAN=$'\033[36m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_WHITE=$'\033[97m'
else
  C_RESET=''
  C_DIM=''
  C_CYAN=''
  C_GREEN=''
  C_YELLOW=''
  C_RED=''
  C_WHITE=''
fi

BOX_TEXT=40
BOX_INNER=$((BOX_TEXT + 2))
printf -v BOX_RULE '%*s' "$BOX_INNER" ''
BOX_RULE="${BOX_RULE// /─}"
box_start() { printf '\n%s╭%s╮%s\n' "$C_CYAN" "$BOX_RULE" "$C_RESET"; }
box_line() { printf '%s│  %-40s  │%s\n' "$C_CYAN" "$1" "$C_RESET"; }
box_end() { printf '%s╰%s╯%s\n' "$C_CYAN" "$BOX_RULE" "$C_RESET"; }

RUN_SEED=0
SKIP_BACKUP=0
DEPLOY_BRANCH="main"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --seed) RUN_SEED=1; shift ;;
    --no-backup) SKIP_BACKUP=1; shift ;;
    --branch) DEPLOY_BRANCH="${2:?--branch braucht einen Wert}"; shift 2 ;;
    -h|--help)
      sed '1d' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 1 ;;
  esac
done

export APP_DIR RUN_SEED SKIP_BACKUP DEPLOY_BRANCH
cd "$APP_DIR"

if [ "$SKIP_BACKUP" -eq 1 ]; then
  BACKUP_LABEL="übersprungen"
else
  BACKUP_LABEL="aktiv"
fi

box_start
box_line "FIB HR · UPDATE MANAGER"
box_line "Branch: $DEPLOY_BRANCH"
box_line "Backup: $BACKUP_LABEL"
box_end

# Wichtig: deploy-server.sh liegt im Repo und wird von `git reset --hard`
# mitten im Lauf überschrieben. Bash liest Skripte fortlaufend aus der Datei —
# würde die Datei sich darunter ändern, führt das zu Fehlern. Deshalb in eine
# stabile temporäre Kopie ausführen. Die Kopie kommt direkt vom Ziel-Branch,
# damit ein einziger Aufruf bereits die aktuelle Deploy-Logik verwendet.
TMP_DEPLOY="$(mktemp)"
trap 'rm -f "$TMP_DEPLOY"' EXIT
printf '%s⟳%s Aktualisiere Deploy-Logik …\n' "$C_CYAN" "$C_RESET"
if git fetch origin "$DEPLOY_BRANCH" >/dev/null 2>&1; then
  printf '%s✓%s Deploy-Logik ist aktuell.\n' "$C_GREEN" "$C_RESET"
else
  printf '%s✗%s Remote-Branch konnte nicht geladen werden.\n' "$C_RED" "$C_RESET" >&2
  exit 1
fi

if git show "origin/$DEPLOY_BRANCH:scripts/deploy-server.sh" > "$TMP_DEPLOY"; then
  printf '%s✓%s Stabile Deploy-Ausführung vorbereitet.\n' "$C_GREEN" "$C_RESET"
else
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
