#!/usr/bin/env bash
#
# auto-deploy.sh — vom Cron jede Minute aufgerufen (Einrichtung: scripts/install-auto-deploy.sh).
#
# Holt origin/<branch> und startet scripts/update.sh nur, wenn dort ein Commit
# liegt, der noch nicht deployt ist. Ohne Änderung kostet ein Lauf ein `git fetch`.
#
# Ausgaben landen in deploy-logs/auto-deploy.log, die Details jedes Deploys wie
# gewohnt in deploy-logs/deploy-*.log.
#
# Ein fehlgeschlagener Commit wird nicht jede Minute wiederholt, sondern erst,
# wenn ein neuer Commit kommt (oder deploy-logs/.auto-deploy-failed gelöscht wird).

# Alles steckt in main(): Bash liest den Funktionsrumpf vollständig ein, bevor er
# läuft – `git reset --hard` darf diese Datei also während des Laufs ersetzen.
main() {
  set -euo pipefail

  local app_dir branch log_dir new_sha deployed_sha failed_sha
  app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  branch="${DEPLOY_BRANCH:-main}"
  log_dir="$app_dir/deploy-logs"
  mkdir -p "$log_dir"

  # Läuft der vorige Aufruf noch (z. B. ein Build), still beenden.
  exec 8>"$log_dir/.auto-deploy.lock"
  if command -v flock >/dev/null 2>&1; then
    flock -n 8 || return 0
  fi

  cd "$app_dir"
  # Protokoll klein halten: ab 1 MB nur die letzten 2000 Zeilen behalten.
  if [[ -f "$log_dir/auto-deploy.log" && $(wc -c <"$log_dir/auto-deploy.log") -gt 1048576 ]]; then
    tail -n 2000 "$log_dir/auto-deploy.log" >"$log_dir/auto-deploy.log.tmp" && mv "$log_dir/auto-deploy.log.tmp" "$log_dir/auto-deploy.log"
  fi

  export GIT_TERMINAL_PROMPT=0
  git fetch --quiet origin "$branch" || { log "git fetch fehlgeschlagen"; return 1; }

  new_sha="$(git rev-parse "origin/$branch")"
  deployed_sha="$(cat "$log_dir/.last-deployed-sha" 2>/dev/null || true)"
  failed_sha="$(cat "$log_dir/.auto-deploy-failed" 2>/dev/null || true)"
  [[ "$new_sha" == "$deployed_sha" || "$new_sha" == "$failed_sha" ]] && return 0

  log "Neuer Stand ${new_sha:0:7} – starte Deploy"
  if NO_COLOR=1 bash scripts/update.sh --branch "$branch" 8>&- >>"$log_dir/auto-deploy.log" 2>&1; then
    rm -f "$log_dir/.auto-deploy-failed"
    log "Deploy ${new_sha:0:7} erfolgreich"
  else
    echo "$new_sha" >"$log_dir/.auto-deploy-failed"
    log "Deploy ${new_sha:0:7} FEHLGESCHLAGEN – nächster Versuch beim nächsten Commit"
    return 1
  fi
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy-logs/auto-deploy.log"
}

main "$@"; exit $?
