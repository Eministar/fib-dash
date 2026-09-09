#!/usr/bin/env bash
#
# Hebt die nginx-Limits fuer grosse Bodycam-Uploads an — auf einem bereits
# laufenden Server. Das Setup-Skript legt die Site nur bei der Erstinstallation
# an, ein Redeploy fasst nginx nicht mehr an.
#
# Aufruf auf dem Server:  sudo bash scripts/fix-nginx-uploads.sh
#
# Die Direktiven landen bewusst im http-Kontext (conf.d), damit sie fuer jeden
# server-Block gelten — auch fuer den 443-Block, den certbot spaeter erzeugt.

set -euo pipefail

CONF="/etc/nginx/conf.d/fib-dash-uploads.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte mit sudo ausfuehren." >&2
  exit 1
fi

cat > "$CONF" <<'NGINX'
# Bodycam-Clips duerfen 500 MiB gross sein (CLIP_MAX_BYTES in der App).
# Ein kleineres Limit hier laesst den Upload im Browser mittendrin einfrieren,
# weil nginx das Lesen abbricht, bevor die App ueberhaupt antworten kann.
client_max_body_size 512M;
client_body_timeout 1800s;

# Body direkt an die App durchreichen statt ihn erst komplett auf Platte zu
# puffern — sonst steht der Fortschrittsbalken minutenlang auf 100 %.
proxy_request_buffering off;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
NGINX

echo "Geschrieben: $CONF"

# Eine alte, engere Angabe in der Site-Datei wuerde die http-Vorgabe wieder
# ueberschreiben, deshalb hier melden statt still zu scheitern.
if grep -rn --include='*' 'client_max_body_size' /etc/nginx/sites-enabled/ 2>/dev/null; then
  echo
  echo "ACHTUNG: Oben stehende Site-Dateien setzen client_max_body_size selbst."
  echo "Diese Werte gewinnen gegen conf.d — dort auf 512M setzen oder die Zeile entfernen."
fi

nginx -t
systemctl reload nginx
echo "nginx neu geladen. Upload-Limit steht auf 512M."
