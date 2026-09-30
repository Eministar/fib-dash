#!/usr/bin/env bash
#
# deploy-server.sh — Auto-Deploy auf dem Linux-Server (screen-basiert).
#
# Wird per SSH vom GitHub-Actions-Workflow (.github/workflows/deploy.yml)
# über stdin hereingepiped bzw. von scripts/update.sh aus einer temporären
# Kopie gestartet, damit immer die AKTUELLE Version des Skripts läuft.
#
# Env-Variablen:
#   APP_DIR        Pfad zum Anwendungsstamm (Pflicht)
#   SCREEN_NAME    Screen-Session der App (Default: FIBPANEL)
#   DEPLOY_BRANCH  Branch (Default: main)
#   APP_PORT       Port für den Health-Check (Default: $PORT bzw. 3000)
#   FORCE=1        Alle Schritte ausführen, auch ohne Änderungen
#   RUN_SEED=1     Seed ausführen (setzt Gruppen-/Unit-Rechte zurück!)
#   SKIP_BACKUP=1  Backup nie ausführen
#   FORCE_BACKUP=1 Backup auch ohne Schema-Änderung
#
# Inkrementell: Es läuft nur, was die neuen Commits wirklich brauchen.
#   package.json / package-lock.json geändert  → npm ci
#   prisma/schema.prisma geändert              → Backup + db push
#   nur Doku (*.md, docs/, .github/) geändert  → kein Build, kein Neustart
#
# Sicherheits-Design:
#   - DB-Backup VOR jeder Schema-Änderung.
#   - `prisma db push` OHNE --accept-data-loss: destruktive Änderungen brechen
#     den Deploy ab (kein stiller Datenverlust).
#   - Build läuft, während die alte App noch bedient; Neustart erst am Ende,
#     danach Health-Check.

set -euo pipefail

APP_DIR="${APP_DIR:?APP_DIR ist nicht gesetzt}"
SCREEN_NAME="${SCREEN_NAME:-FIBPANEL}"
BRANCH="${DEPLOY_BRANCH:-main}"
APP_PORT="${APP_PORT:-${PORT:-3000}}"
FORCE="${FORCE:-0}"
RUN_SEED="${RUN_SEED:-0}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
FORCE_BACKUP="${FORCE_BACKUP:-0}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-90}"
NODE_MAX_OLD_SPACE_MB="${NODE_MAX_OLD_SPACE_MB:-1024}"

# ── Darstellung ──────────────────────────────────────────────────────

# UTF-8-Locale, damit ${#text} Zeichen statt Bytes zählt (Rahmen bleibt gerade).
if [[ "$(locale charmap 2>/dev/null)" != "UTF-8" ]]; then
  for candidate in C.UTF-8 C.utf8 en_US.UTF-8; do
    if [[ "$(LC_ALL=$candidate locale charmap 2>/dev/null)" == "UTF-8" ]]; then export LC_ALL=$candidate; break; fi
  done
fi

if [[ -t 1 && "${NO_COLOR:-}" != "1" ]]; then
  C_RESET=$'\033[0m' C_DIM=$'\033[2m' C_BOLD=$'\033[1m'
  C_CYAN=$'\033[36m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_RED=$'\033[31m' C_WHITE=$'\033[97m'
else
  C_RESET='' C_DIM='' C_BOLD='' C_CYAN='' C_GREEN='' C_YELLOW='' C_RED='' C_WHITE=''
fi
ANIMATE=0
[[ -t 1 && "${CI:-}" != "true" && "${NO_COLOR:-}" != "1" ]] && ANIMATE=1

BOX_WIDTH=56
box_rule() { local r; printf -v r '%*s' "$((BOX_WIDTH + 2))" ''; printf '%s' "${r// /─}"; }
box_start() { printf '\n%s╭%s╮%s\n' "$C_CYAN" "$(box_rule)" "$C_RESET"; }
box_end() { printf '%s╰%s╯%s\n' "$C_CYAN" "$(box_rule)" "$C_RESET"; }
# printf-Breiten zählen Bytes, nicht Zeichen – bei Umlauten/Pfeilen selbst auffüllen.
pad() { local text="$1" width="$2"; printf '%s%*s' "$text" $(( width > ${#text} ? width - ${#text} : 0 )) ''; }
box_line() {
  printf '%s│%s %s %s│%s\n' "$C_CYAN" "$C_RESET" "$(pad "${1:0:$BOX_WIDTH}" "$BOX_WIDTH")" "$C_CYAN" "$C_RESET"
}

info() { printf '  %s│%s %s\n' "$C_DIM" "$C_RESET" "$1"; }
warn() { printf '  %s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
fail() { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

fmt_duration() {
  local s="$1"
  if (( s >= 60 )); then printf '%dm %02ds' $((s / 60)) $((s % 60)); else printf '%ds' "$s"; fi
}

# ── Schritte ─────────────────────────────────────────────────────────

DEPLOY_STARTED="$(date +%s)"
LOG_DIR="$APP_DIR/deploy-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y-%m-%d_%H-%M-%S).log"
# Alte Logs aufräumen (die letzten 20 behalten).
ls -1t "$LOG_DIR"/deploy-*.log 2>/dev/null | tail -n +21 | xargs -r rm -f || true

STEP_INDEX=0
STEP_TOTAL=0
SUMMARY=()

summary_add() { SUMMARY+=("$1|$2|$3"); }

step_prefix() { printf '%s[%d/%d]%s' "$C_DIM" "$STEP_INDEX" "$STEP_TOTAL" "$C_RESET"; }

# skip_step "Label" "Grund"
skip_step() {
  STEP_INDEX=$((STEP_INDEX + 1))
  printf '  %s %s–%s %s%s %s(%s)%s\n' "$(step_prefix)" "$C_DIM" "$C_RESET" "$C_DIM" "$1" "$C_DIM" "$2" "$C_RESET"
  summary_add skip "$1" "$2"
}

# run_step "Label" cmd args…  → Ausgabe ins Log, bei Fehler die letzten Zeilen anzeigen.
run_step() {
  local label="$1"; shift
  STEP_INDEX=$((STEP_INDEX + 1))
  local started status elapsed pid frame=0
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  started="$(date +%s)"
  printf '\n━━ %s\n' "$label" >>"$LOG_FILE"

  if [[ "$ANIMATE" -eq 1 ]]; then
    # stdin kappen: beim Pipen über `bash -s` würden Kindprozesse sonst das Skript mitlesen.
    "$@" </dev/null >>"$LOG_FILE" 2>&1 &
    pid=$!
    while kill -0 "$pid" 2>/dev/null; do
      elapsed=$(( $(date +%s) - started ))
      printf '\r  %s %s%s%s %s %s%s%s' "$(step_prefix)" "$C_CYAN" "${frames[$frame]}" "$C_RESET" "$label" "$C_DIM" "$(fmt_duration "$elapsed")" "$C_RESET"
      frame=$(( (frame + 1) % ${#frames[@]} ))
      sleep 0.1
    done
    if wait "$pid"; then status=0; else status=$?; fi
    printf '\r\033[K'
  else
    printf '  %s … %s\n' "$(step_prefix)" "$label"
    if "$@" </dev/null >>"$LOG_FILE" 2>&1; then status=0; else status=$?; fi
  fi

  elapsed=$(( $(date +%s) - started ))
  if [[ "$status" -eq 0 ]]; then
    printf '  %s %s✓%s %s %s%s%s\n' "$(step_prefix)" "$C_GREEN" "$C_RESET" "$label" "$C_DIM" "$(fmt_duration "$elapsed")" "$C_RESET"
    summary_add ok "$label" "$elapsed"
  else
    printf '  %s %s✗%s %s %s%s%s\n' "$(step_prefix)" "$C_RED" "$C_RESET" "$label" "$C_DIM" "$(fmt_duration "$elapsed")" "$C_RESET"
    summary_add fail "$label" "$elapsed"
    printf '\n%s  ── letzte Log-Zeilen ─────────────────────────────%s\n' "$C_DIM" "$C_RESET" >&2
    tail -n 40 "$LOG_FILE" | sed 's/^/    /' >&2
    printf '%s  ── vollständiges Log: %s%s\n' "$C_DIM" "$LOG_FILE" "$C_RESET" >&2
  fi
  return "$status"
}

print_summary() {
  local total=$(( $(date +%s) - DEPLOY_STARTED )) entry kind label value
  printf '\n  %sZusammenfassung%s\n' "$C_BOLD" "$C_RESET"
  for entry in "${SUMMARY[@]}"; do
    IFS='|' read -r kind label value <<<"$entry"
    case "$kind" in
      ok)   printf '  %s✓%s %s %s%s%s\n' "$C_GREEN" "$C_RESET" "$(pad "$label" 46)" "$C_DIM" "$(fmt_duration "$value")" "$C_RESET" ;;
      fail) printf '  %s✗%s %s %s%s%s\n' "$C_RED" "$C_RESET" "$(pad "$label" 46)" "$C_DIM" "$(fmt_duration "$value")" "$C_RESET" ;;
      skip) printf '  %s– %s übersprungen%s\n' "$C_DIM" "$(pad "$label" 46)" "$C_RESET" ;;
    esac
  done
  printf '  %s%s%s\n' "$C_DIM" "────────────────────────────────────────────────────────" "$C_RESET"
  printf '    %s %s%s%s\n' "$(pad Gesamt 46)" "$C_BOLD" "$(fmt_duration "$total")" "$C_RESET"
}

must_step() {
  if ! run_step "$@"; then
    print_summary
    printf '\n'
    fail "Deploy abgebrochen. Die laufende App bleibt unverändert."
    exit 1
  fi
}

app_running() { screen -ls 2>/dev/null | grep -q "[.]${SCREEN_NAME}[[:space:]]"; }

# ── Änderungen ermitteln ─────────────────────────────────────────────

cd "$APP_DIR"
[[ "$ANIMATE" -eq 1 ]] && printf '\n  %s⟳%s Prüfe auf Updates …' "$C_CYAN" "$C_RESET"
if ! git fetch --quiet origin "$BRANCH" </dev/null >>"$LOG_FILE" 2>&1; then
  [[ "$ANIMATE" -eq 1 ]] && printf '\r\033[K'
  fail "git fetch origin $BRANCH fehlgeschlagen (Details: $LOG_FILE)"
  exit 1
fi
[[ "$ANIMATE" -eq 1 ]] && printf '\r\033[K'

# Verglichen wird mit dem letzten ERFOLGREICHEN Deploy, nicht mit HEAD: Bricht ein
# Build ab, steht HEAD schon auf dem neuen Commit – der nächste Lauf muss ihn trotzdem bauen.
STATE_FILE="$LOG_DIR/.last-deployed-sha"
OLD_SHA="$(cat "$STATE_FILE" 2>/dev/null || true)"
if [[ -z "$OLD_SHA" ]] || ! git cat-file -e "$OLD_SHA^{commit}" 2>/dev/null; then
  OLD_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
fi
NEW_SHA="$(git rev-parse "origin/$BRANCH")"
short() { git rev-parse --short "$1" 2>/dev/null || echo "${1:0:7}"; }

FULL=0
CHANGED=""
if [[ "$FORCE" == "1" ]]; then
  FULL=1
elif [[ -z "$OLD_SHA" ]] || ! git merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA" 2>/dev/null; then
  # Unbekannter/abweichender Stand (z. B. Force-Push) → sicherheitshalber alles.
  FULL=1
else
  CHANGED="$(git diff --name-only "$OLD_SHA" "$NEW_SHA")"
fi

changed_matches() { [[ "$FULL" == "1" ]] || grep -qE "$1" <<<"$CHANGED"; }

NEED_INSTALL=0; INSTALL_REASON="keine Änderung an package*.json"
if [[ ! -d node_modules || ! -f node_modules/.package-lock.json ]]; then
  NEED_INSTALL=1; INSTALL_REASON=""
elif changed_matches '^package(-lock)?\.json$'; then
  NEED_INSTALL=1
fi

NEED_SCHEMA=0
changed_matches '^prisma/schema\.prisma$|^prisma\.config\.ts$' && NEED_SCHEMA=1

NEED_BUILD=0
if [[ "$FULL" == "1" || ! -f .next/BUILD_ID ]]; then
  NEED_BUILD=1
elif [[ -n "$CHANGED" ]] && grep -vqE '(^docs/|^\.github/|\.md$)' <<<"$CHANGED"; then
  NEED_BUILD=1
fi

NEED_BACKUP=0; BACKUP_REASON="Schema unverändert"
if [[ "$SKIP_BACKUP" == "1" ]]; then
  BACKUP_REASON="--no-backup"
elif [[ "$NEED_SCHEMA" == "1" || "$FORCE_BACKUP" == "1" ]]; then
  NEED_BACKUP=1
fi

UP_TO_DATE=0
[[ "$OLD_SHA" == "$NEW_SHA" && "$FORCE" != "1" ]] && UP_TO_DATE=1

# ── Kopf ─────────────────────────────────────────────────────────────

box_start
box_line "FIB HR · SERVER UPDATE"
box_line ""
box_line "Branch   $BRANCH"
if [[ "$UP_TO_DATE" == "1" ]]; then
  box_line "Stand    $(short "$NEW_SHA") (bereits aktuell)"
else
  box_line "Stand    $(short "$OLD_SHA") → $(short "$NEW_SHA")"
fi
[[ "$FORCE" == "1" ]] && box_line "Modus    vollständig (--force)"
box_end

if [[ "$UP_TO_DATE" == "1" ]]; then
  if app_running; then
    # Erster Lauf dieser Skript-Version: laufenden Stand als deployt übernehmen.
    [[ -f "$STATE_FILE" ]] || echo "$NEW_SHA" > "$STATE_FILE"
    printf '\n  %s✓%s Bereits auf dem neuesten Stand – nichts zu tun.\n' "$C_GREEN" "$C_RESET"
    info "Mit --force wird trotzdem komplett neu gebaut."
    exit 0
  fi
  warn "Code ist aktuell, aber die App läuft nicht – sie wird gestartet."
  NEED_INSTALL=0; NEED_SCHEMA=0; NEED_BACKUP=0
  INSTALL_REASON="bereits aktuell"; BACKUP_REASON="bereits aktuell"
  [[ -f .next/BUILD_ID ]] && NEED_BUILD=0
  NEED_RESTART=1
fi

if [[ -n "$CHANGED" ]]; then
  COMMIT_COUNT="$(git rev-list --count "$OLD_SHA..$NEW_SHA")"
  printf '\n  %sNeue Commits (%s)%s\n' "$C_BOLD" "$COMMIT_COUNT" "$C_RESET"
  git log --format='%h %s' -n 8 "$OLD_SHA..$NEW_SHA" | while read -r sha subject; do
    printf '  %s%s%s %s\n' "$C_DIM" "$sha" "$C_RESET" "${subject:0:70}"
  done
  (( COMMIT_COUNT > 8 )) && info "… und $((COMMIT_COUNT - 8)) weitere"
  printf '  %s%s Dateien geändert%s\n' "$C_DIM" "$(grep -c . <<<"$CHANGED")" "$C_RESET"
fi

NEED_RESTART="${NEED_RESTART:-$NEED_BUILD}"

# Anzahl der Schritte für die [x/y]-Anzeige.
STEP_TOTAL=5   # Backup, Code, Abhängigkeiten, Schema, Build
[[ "$NEED_SCHEMA" == "1" && "$NEED_INSTALL" == "0" ]] && STEP_TOTAL=$((STEP_TOTAL + 1))
[[ "$RUN_SEED" == "1" ]] && STEP_TOTAL=$((STEP_TOTAL + 1))
STEP_TOTAL=$((STEP_TOTAL + 2))   # Neustart, Health-Check
printf '\n'

# ── Ablauf ───────────────────────────────────────────────────────────

if [[ "$NEED_BACKUP" == "1" ]]; then
  # Non-fatal: ein fehlgeschlagenes Backup darf den Deploy nicht blockieren.
  run_step "Datenbank-Backup" npm run --silent db:backup \
    || warn "Backup fehlgeschlagen – Deploy wird fortgesetzt (db push bricht bei Datenverlust ab)."
else
  skip_step "Datenbank-Backup" "$BACKUP_REASON"
fi

if [[ "$UP_TO_DATE" == "1" ]]; then
  skip_step "Code aktualisieren" "bereits aktuell"
else
  must_step "Code aktualisieren ($(short "$NEW_SHA"))" git reset --hard --quiet "origin/$BRANCH"
fi

# npm ci scheitert mit ENOTEMPTY, wenn node_modules von einem abgebrochenen
# Lauf halb gelöscht zurückbleibt → einmal komplett entfernen und neu versuchen.
install_dependencies() {
  npm ci --prefer-offline --no-audit --no-fund && return 0
  echo "npm ci fehlgeschlagen — node_modules wird entfernt und neu installiert" >&2
  rm -rf node_modules
  npm ci --prefer-offline --no-audit --no-fund
}
if [[ "$NEED_INSTALL" == "1" ]]; then
  must_step "Abhängigkeiten installieren" install_dependencies
else
  skip_step "Abhängigkeiten installieren" "$INSTALL_REASON"
fi

if [[ "$NEED_SCHEMA" == "1" ]]; then
  # Bei npm ci erzeugt postinstall den Client bereits.
  [[ "$NEED_INSTALL" == "0" ]] && must_step "Prisma-Client generieren" npx prisma generate
  must_step "Schema anwenden (db push, ohne Datenverlust)" npx prisma db push
else
  skip_step "Schema anwenden" "Schema unverändert"
fi

# Optionaler Seed — nur mit --seed, weil er Gruppen-/Unit-Rechte zurücksetzt.
[[ "$RUN_SEED" == "1" ]] && must_step "Seed ausführen" npm run --silent db:seed

if [[ "$NEED_BUILD" == "1" ]]; then
  # build = prisma generate && next build (inkrementell dank Turbopack-Cache in .next/)
  must_step "Production-Build erstellen" npm run --silent build
else
  skip_step "Production-Build erstellen" "nur Doku geändert"
fi

restart_app() {
  screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true
  # Warten, bis die alte Instanz den Port freigegeben hat (max. 10 s).
  local i
  for i in $(seq 1 20); do
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$APP_PORT/" || break
    sleep 0.5
  done
  # V8-Heap deckeln: ohne Limit wählt Node das Ceiling nach RAM und gibt
  # Speicher nie ans OS zurück. Muss beim Start als echte Env-Var gesetzt sein.
  screen -dmS "$SCREEN_NAME" env "NODE_OPTIONS=--max-old-space-size=$NODE_MAX_OLD_SPACE_MB" npm run start
}

wait_for_health() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_S )) code
  while (( $(date +%s) < deadline )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$APP_PORT/api/health" || true)"
    case "$code" in
      200|207) echo "Health: HTTP $code"; return 0 ;;
      503) echo "Health: HTTP 503 (App läuft, meldet aber DOWN)"; return 0 ;;
    esac
    if ! app_running; then echo "Screen-Session $SCREEN_NAME ist beendet – App ist abgestürzt."; return 1; fi
    sleep 1
  done
  echo "Keine Antwort von http://127.0.0.1:$APP_PORT/api/health nach ${HEALTH_TIMEOUT_S}s"
  return 1
}

if [[ "$NEED_RESTART" == "1" ]]; then
  must_step "App neu starten (Screen: $SCREEN_NAME)" restart_app
  if ! run_step "Health-Check (Port $APP_PORT)" wait_for_health; then
    print_summary
    printf '\n'
    fail "Die App antwortet nicht. Log ansehen: screen -r $SCREEN_NAME"
    exit 1
  fi
  grep -q 'HTTP 503' "$LOG_FILE" && warn "Health meldet DOWN – Details unter /api/health."
else
  skip_step "App neu starten" "kein neuer Build"
  skip_step "Health-Check" "kein Neustart"
fi

echo "$NEW_SHA" > "$STATE_FILE"
print_summary
printf '\n  %s✓ Update erfolgreich abgeschlossen%s  %s· Node-Heap %s MB · Log %s%s\n\n' \
  "$C_GREEN$C_BOLD" "$C_RESET" "$C_DIM" "$NODE_MAX_OLD_SPACE_MB" "$LOG_FILE" "$C_RESET"
