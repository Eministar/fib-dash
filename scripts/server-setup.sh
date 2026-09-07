#!/usr/bin/env bash
#
# server-setup.sh — richtet einen frischen Server fuer das FIB-Panel ein.
# Nutzt die BESTEHENDE .env im App-Ordner; erzeugt und aendert keine Konfiguration.
#
#   sudo bash scripts/server-setup.sh --domain nerovfib.de --email du@example.com
#
# Schritte: Pakete (Node 22, screen, nginx, certbot) → npm ci → prisma generate
#           → prisma db push → build → nginx-Proxy + HTTPS → screen-Session starten.
#
# Danach laufen Updates ueber:  bash scripts/update.sh
#
set -euo pipefail

DOMAIN=""
EMAIL=""
APP_DIR=""
APP_PORT="3000"
SCREEN_NAME="FIBPANEL"
RUN_USER="${SUDO_USER:-root}"
SKIP_TLS=0

usage() {
  cat <<'EOF'
server-setup.sh — Server fuer das FIB-Panel einrichten (nutzt die bestehende .env)

  sudo bash scripts/server-setup.sh --domain nerovfib.de --email du@example.com

Optionen:
  --domain <fqdn>   Domain, z. B. nerovfib.de                      (Pflicht)
  --email <mail>    E-Mail fuer Let's Encrypt          (Pflicht, ausser --no-tls)
  --app-dir <pfad>  App-Ordner       (Default: Ordner, in dem dieses Skript liegt)
  --port <nr>       Interner App-Port                          (Default: 3000)
  --user <name>     Benutzer, der die App faehrt      (Default: aufrufender User)
  --no-tls          nginx ohne HTTPS einrichten (kein certbot)
  -h, --help        Diese Hilfe
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --domain)  DOMAIN="${2:?--domain braucht einen Wert}"; shift 2 ;;
    --email)   EMAIL="${2:?--email braucht einen Wert}"; shift 2 ;;
    --app-dir) APP_DIR="${2:?}"; shift 2 ;;
    --port)    APP_PORT="${2:?}"; shift 2 ;;
    --user)    RUN_USER="${2:?}"; shift 2 ;;
    --no-tls)  SKIP_TLS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=''; C_CYAN=''; C_GREEN=''; C_YELLOW=''; C_RED=''
fi
log()  { printf '\n%s━━ %s%s\n' "$C_CYAN" "$1" "$C_RESET"; }
ok()   { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
info() { printf '%s│%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn() { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$1" >&2; }
die()  { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

# App-Ordner: Standard ist das Elternverzeichnis dieses Skripts.
if [ -z "$APP_DIR" ]; then
  APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausfuehren."
[ -n "$DOMAIN" ] || die "--domain fehlt. Beispiel: --domain nerovfib.de"
[ "$SKIP_TLS" -eq 1 ] || [ -n "$EMAIL" ] || die "--email fehlt (fuer Let's Encrypt) oder --no-tls nutzen."
command -v apt-get >/dev/null || die "Dieses Skript ist fuer Debian/Ubuntu (apt) gebaut."
id "$RUN_USER" >/dev/null 2>&1 || die "Benutzer '$RUN_USER' existiert nicht. Mit --user setzen."
[ -f "$APP_DIR/package.json" ] || die "In $APP_DIR liegt keine package.json. Mit --app-dir den App-Ordner angeben."
[ -f "$APP_DIR/.env" ] || die "In $APP_DIR fehlt die .env. Bitte zuerst anlegen."

SITE_URL="https://$DOMAIN"
[ "$SKIP_TLS" -eq 1 ] && SITE_URL="http://$DOMAIN"

printf '\n%s╭──────────────────────────────────────╮%s\n' "$C_CYAN" "$C_RESET"
printf '%s│  FIB PANEL · SERVER-SETUP            │%s\n' "$C_CYAN" "$C_RESET"
printf '%s╰──────────────────────────────────────╯%s\n' "$C_CYAN" "$C_RESET"
info "Domain:      $DOMAIN"
info "App-Ordner:  $APP_DIR"
info "Benutzer:    $RUN_USER"
info "Port:        $APP_PORT (intern, nginx proxied darauf)"

# Die .env wird nur gelesen — aber ohne diesen Wert laeuft der Discord-Login ins Leere.
if ! grep -qE "^\s*NEXT_PUBLIC_SITE_URL=\"?https?://$DOMAIN" "$APP_DIR/.env"; then
  warn "NEXT_PUBLIC_SITE_URL in der .env zeigt nicht auf $DOMAIN."
  warn "Der Discord-Login faellt sonst auf localhost zurueck. Setze:"
  warn "  NEXT_PUBLIC_SITE_URL=\"$SITE_URL\""
  warn "Der Wert wird in den Build eingebacken — danach dieses Skript erneut laufen lassen."
fi

# ------------------------------------------------------------------- Pakete --
log "Systempakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git screen nginx cron >/dev/null
ok "git, screen, nginx, cron installiert"

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 22 ]; then
  info "Installiere Node.js 22 (NodeSource) …"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) · npm $(npm -v)"

# ------------------------------------------------------------ Build & Schema --
log "Installation & Build"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
run_as() { sudo -u "$RUN_USER" bash -lc "cd '$APP_DIR' && $1"; }

info "npm ci …"
run_as "npm ci --no-audit --no-fund" >/dev/null
ok "Dependencies installiert"

info "prisma generate …"
run_as "npx prisma generate" >/dev/null
ok "Prisma-Client erzeugt"

# Ohne --accept-data-loss: additive Aenderungen laufen durch, destruktive brechen ab.
info "prisma db push …"
run_as "npx prisma db push" >/dev/null
ok "Schema in der Datenbank"

info "Production-Build … (dauert 1-2 Minuten)"
run_as "npm run build" >/dev/null
ok "Build erstellt"

# -------------------------------------------------------------------- nginx --
log "Webserver"
NGINX_SITE="/etc/nginx/sites-available/$DOMAIN"
cat > "$NGINX_SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Uploads bis 25 MB durchlassen (nginx-Default waeren 1 MB).
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || die "nginx-Konfiguration fehlerhaft — Details: nginx -t"
systemctl reload nginx
ok "nginx proxied $DOMAIN → 127.0.0.1:$APP_PORT"

if [ "$SKIP_TLS" -eq 0 ]; then
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect >/dev/null 2>&1; then
    ok "HTTPS aktiv (Let's Encrypt, Erneuerung laeuft ueber certbot.timer)"
  else
    warn "certbot fehlgeschlagen — meist zeigt das DNS von $DOMAIN noch nicht hierher."
    warn "Spaeter nachholen:  certbot --nginx -d $DOMAIN"
  fi
fi

# ---------------------------------------------------------------- App-Start --
log "Anwendung starten"
# Heap deckeln: ohne Limit waehlt V8 mehrere GB und gibt sie nie ans OS zurueck.
NODE_MAX_OLD_SPACE_MB="${NODE_MAX_OLD_SPACE_MB:-1024}"
START_CMD="screen -dmS $SCREEN_NAME env NODE_OPTIONS=--max-old-space-size=$NODE_MAX_OLD_SPACE_MB PORT=$APP_PORT npm run start"

sudo -u "$RUN_USER" screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1 || true
sleep 2
run_as "$START_CMD"
ok "Screen-Session '$SCREEN_NAME' gestartet"

# screen ueberlebt keinen Reboot — deshalb ein @reboot-Cron.
if ! sudo -u "$RUN_USER" crontab -l 2>/dev/null | grep -qF "screen -dmS $SCREEN_NAME"; then
  { sudo -u "$RUN_USER" crontab -l 2>/dev/null || true; echo "@reboot cd $APP_DIR && $START_CMD"; } \
    | sudo -u "$RUN_USER" crontab -
  ok "@reboot-Cron gesetzt (App startet nach Serverneustart automatisch)"
else
  ok "@reboot-Cron war schon vorhanden"
fi

# ----------------------------------------------------------------- Kontrolle --
log "Kontrolle"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/api/setup/status" 2>/dev/null; then
    ok "App antwortet auf 127.0.0.1:$APP_PORT"
    break
  fi
  [ "$i" -eq 30 ] && warn "App antwortet nach 30s nicht — Logs ansehen: screen -r $SCREEN_NAME"
  sleep 1
done

code="$(curl -s -o /dev/null -w '%{http_code}' -L "$SITE_URL" --max-time 15 || echo 000)"
if [ "$code" = "200" ]; then ok "$SITE_URL liefert HTTP 200"; else warn "$SITE_URL liefert HTTP $code"; fi

printf '\n%s╭──────────────────────────────────────╮%s\n' "$C_GREEN" "$C_RESET"
printf '%s│  FERTIG                              │%s\n' "$C_GREEN" "$C_RESET"
printf '%s╰──────────────────────────────────────╯%s\n' "$C_GREEN" "$C_RESET"
cat <<EOF

  Panel:   $SITE_URL
  Logs:    screen -r $SCREEN_NAME        (raus mit Strg+A, dann D)
  Update:  cd $APP_DIR && bash scripts/update.sh

  Im Discord Developer Portal eintragen:
    OAuth2 → Redirects:            $SITE_URL/api/auth/discord/callback
    Interactions Endpoint URL:     $SITE_URL/api/discord/interactions

EOF
