#!/bin/bash
# SEC-02/03/05 live nginx test (needs root, nginx, openssl, a running API on 127.0.0.1:3100 reachable as host "api"). Installs the repo configs under /etc/nginx and runs a throw-away nginx.
cd "$(dirname "$0")/.."
mkdir -p /etc/nginx/certs /usr/share/nginx/html /var/www/acme
cp deploy/nginx/erpx-common.conf deploy/nginx/erpx-locations.conf /etc/nginx/; cp deploy/nginx/proxy.conf /etc/nginx/erpx-proxy.conf; cp deploy/nginx/security-headers.conf /etc/nginx/erpx-security-headers.conf; cp -r web/. /usr/share/nginx/html/
[ -f /etc/nginx/certs/fullchain.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=localhost" -keyout /etc/nginx/certs/privkey.pem -out /etc/nginx/certs/fullchain.pem 2>/dev/null
grep -q "127.0.0.1 api" /etc/hosts || echo "127.0.0.1 api" >> /etc/hosts
cat > /tmp/nginx-test.conf <<'EOC'
worker_processes 1; pid /tmp/nginx-test.pid; error_log /tmp/nginx-err.log;
events { worker_connections 256; }
http { include /etc/nginx/mime.types; access_log /tmp/nginx-acc.log; include /tmp/site.conf; }
EOC
fp(){ pkill_nginx; }
run_site(){ # $1=site conf
  sed 's/^  http2 on;//' deploy/nginx/$1.conf > /tmp/site.conf
  nginx -c /tmp/nginx-test.conf 2>&1 | head -2; sleep 1; }
stop_site(){ [ -f /tmp/nginx-test.pid ] && kill $(cat /tmp/nginx-test.pid) 2>/dev/null; sleep 1; }
R=0; chk(){ if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; R=1; fi; }
echo "=== HTTP (dev) site"; run_site default
chk "GET / has CSP + nosniff + frame DENY" "curl -si localhost/ | tr -d '\r' | grep -qi '^content-security-policy' && curl -si localhost/ | grep -qi '^x-content-type-options: nosniff' && curl -si localhost/ | grep -qi '^x-frame-options: DENY'"
chk "dotfile /.env is never served (404)" "[ \$(curl -s -o /dev/null -w '%{http_code}' localhost/.env) = 404 ]"
chk "/api/health proxied" "curl -s localhost/api/health | grep -q '\"ok\":true'"
codes=$(for i in $(seq 1 45); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'content-type: application/json' -d '{"username":"x","password":"y"}' localhost/api/auth/login; done)
chk "login flood -> nginx 429 appears (shared limit)" "echo '$codes' | grep -q 429"
sleep 2
codes=$(for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'content-type: application/json' -d '{}' localhost/api/public/bookings; done)
chk "public bookings flood -> 429 (10/min burst 5)" "echo '$codes' | grep -q 429"
chk "public booking body > 64k refused (413)" "[ \$(head -c 70000 /dev/zero | tr '\0' a | curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data-binary @- localhost/api/public/bookings) = 413 ]"
stop_site
echo "=== HTTPS (production) site"; run_site tls
chk "HTTP 80 redirects to HTTPS (301)" "[ \$(curl -s -o /dev/null -w '%{http_code}' localhost/anything) = 301 ] && curl -si localhost/anything | grep -qi '^location: https://'"
chk "HTTPS serves index with HSTS" "curl -ski https://localhost/ | grep -qi '^strict-transport-security: max-age=31536000'"
chk "HTTPS has CSP/nosniff/DENY/Referrer/Permissions" "H=\$(curl -ski https://localhost/); echo \"\$H\" | grep -qi content-security-policy && echo \"\$H\" | grep -qi 'x-content-type-options' && echo \"\$H\" | grep -qi 'x-frame-options' && echo \"\$H\" | grep -qi referrer-policy && echo \"\$H\" | grep -qi permissions-policy"
chk "HTTPS API health" "curl -sk https://localhost/api/health | grep -q '\"ok\":true'"
chk "TLS1.0/1.1 refused" "! openssl s_client -connect localhost:443 -tls1_1 </dev/null 2>&1 | grep -q 'Cipher is [A-Z]'"
chk "TLS1.2 accepted" "openssl s_client -connect localhost:443 -tls1_2 </dev/null 2>&1 | grep -q 'Cipher is'"
chk "server_tokens off (no version)" "! curl -ski https://localhost/ | grep -qi '^server: nginx/'"
chk "dotfile over HTTPS 404" "[ \$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/.git/config) = 404 ]"
stop_site; exit $R
