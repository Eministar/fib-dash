#!/usr/bin/env bash
#
# deploy-server.sh — Auto-Deploy auf dem Linux-Server (screen-basiert).
#
# Wird per SSH vom GitHub-Actions-Workflow (.github/workflows/deploy.yml)
# ausgeführt und über stdin hereingepiped, damit immer die AKTUELLE Version
# des Skripts läuft (nicht die alte auf dem Server).
#
# Erwartet die Env-Variable APP_DIR (Pfad zum Anwendungsstamm auf dem Server).
# Optional: SCREEN_NAME (Default: FIBPANEL).
#
# Sicherheits-Design:
#   - DB-Backup VOR allem anderen.
#   - `prisma db push` OHNE --accept-data-loss: additive Änderungen laufen durch,
#     destruktive brechen den Deploy ab (kein stiller Datenverlust).
#   - Build läuft, während die alte App noch bedient; Neustart erst ganz am Ende
#     → minimale Downtime.

set -euo pipefail

APP_DIR="${APP_DIR:?APP_DIR ist nicht gesetzt}"
SCREEN_NAME="${SCREEN_NAME:-FIBPANEL}"
BRANCH="${DEPLOY_BRANCH:-main}"

if [[ -t 1 && "${NO_COLOR:-}" != "1" ]]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_CYAN=$'\033[36m'
  C_BLUE=$'\033[34m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_WHITE=$'\033[97m'
else
  C_RESET=''
  C_DIM=''
  C_CYAN=''
  C_BLUE=''
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

ANIMATE=0
if [[ -t 1 && "${CI:-}" != "true" && "${NO_COLOR:-}" != "1" ]]; then
  ANIMATE=1
fi

log() { printf '\n%s━━ %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
info() { printf '%s│%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
fail() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

run_step() {
  local label="$1"
  shift
  local started elapsed status pid log_file frame_index=0
  started="$(date +%s)"

  if [[ "$ANIMATE" -eq 1 ]]; then
    log_file="$(mktemp)"
    "$@" >"$log_file" 2>&1 &
    pid=$!
    local frames=('⠋' '⠙' '⠹' '⸸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    while kill -0 "$pid" 2>/dev/null; do
      printf '\r%s%s%s %s' "$C_CYAN" "${frames[$frame_index]}" "$C_RESET" "$label"
      frame_index=$(( (frame_index + 1) % ${#frames[@]} ))
      sleep 0.12
    done
    if wait "$pid"; then status=0; else status=$?; fi
    elapsed=$(( $(date +%s) - started ))
    printf '\r\033[K'
    if [[ "$status" -eq 0 ]]; then
      ok "$label ${C_DIM}(${elapsed}s)${C_RESET}"
    else
      fail "$label fehlgeschlagen ${C_DIM}(${elapsed}s)${C_RESET}"
      cat "$log_file" >&2
    fi
    rm -f "$log_file"
    return "$status"
  fi

  printf '%s…%s %s\n' "$C_CYAN" "$C_RESET" "$label"
  if "$@"; then
    elapsed=$(( $(date +%s) - started ))
    ok "$label ${C_DIM}(${elapsed}s)${C_RESET}"
    return 0
  else
    status=$?
    fail "$label fehlgeschlagen"
    return "$status"
  fi
}

must_step() {
  if ! run_step "$@"; then
    fail "Deploy abgebrochen. Die laufende App bleibt unverändert."
    exit 1
  fi
}

box_start
box_line "FIB HR · SERVER UPDATE"
box_line "Branch: $BRANCH"
box_end

info "Arbeitsverzeichnis: $APP_DIR"
cd "$APP_DIR"

if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  warn "DB-Backup übersprungen (--no-backup)"
else
  log "Sicherung"
  # Non-fatal: ein fehlgeschlagenes Backup darf den Deploy nicht blockieren.
  if ! run_step "Datenbank-Backup" npm run db:backup; then
    warn "Backup fehlgeschlagen — Deploy wird fortgesetzt (Schema-Änderungen sind additiv)."
  fi
fi

log "Code"
must_step "Repository aktualisieren" git fetch origin "$BRANCH"
must_step "Auf origin/$BRANCH wechseln" git reset --hard "origin/$BRANCH"

log "Abhängigkeiten"
must_step "Dependencies installieren" npm ci

log "Datenbank"
must_step "Prisma-Client generieren" npx prisma generate

# Bricht bewusst ab, wenn der Push destruktiv wäre → dann manuell eingreifen.
must_step "Schema anwenden (db push, ohne Datenverlust)" npx prisma db push

# Optionaler Seed — NUR wenn RUN_SEED=1 (z.B. update.sh --seed). Standardmäßig
# aus, weil der Seed Gruppen-/Unit-Rechte auf die Defaults zurücksetzen würde.
if [ "${RUN_SEED:-0}" = "1" ]; then
  log "Optionale Daten"
  must_step "Seed ausführen" npm run db:seed
fi

log "Build & Neustart"
must_step "Production-Build erstellen" npm run build

# Alte Session sauber beenden (Fehler ignorieren, falls keine läuft).
if screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1; then
  info "Alte Screen-Session beendet: $SCREEN_NAME"
else
  info "Keine laufende Screen-Session gefunden — starte frisch"
fi
# Kurz warten, damit der Port freigegeben wird.
sleep 2
# V8-Heap deckeln: ohne Limit wählt Node das Ceiling nach RAM (mehrere GB) und
# gibt Speicher nie ans OS zurück → RSS klettert nach einem Peak auf 2+ GB und
# bleibt dort. Das Limit MUSS beim Start als echte Env-Var gesetzt sein (nicht
# via .env/dotenv — das lädt erst nach dem Node-Start, zu spät für V8-Flags).
# Über NODE_MAX_OLD_SPACE_MB überschreibbar.
NODE_MAX_OLD_SPACE_MB="${NODE_MAX_OLD_SPACE_MB:-1024}"
must_step "App starten (Screen: $SCREEN_NAME)" screen -dmS "$SCREEN_NAME" env "NODE_OPTIONS=--max-old-space-size=$NODE_MAX_OLD_SPACE_MB" npm run start

log "Fertig"
ok "Update erfolgreich abgeschlossen"
info "Node-Heap: ${NODE_MAX_OLD_SPACE_MB} MB"
info "Aktive Screen-Sessions:"
screen -ls || true
