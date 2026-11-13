#!/usr/bin/env bash
set -euo pipefail
cd /opt/cpminiapp
node --check server/server.mjs
node --check server/douyin-worker.mjs
node server/diagnostics.test.mjs
systemd-analyze verify deploy/cpminiapp-logrotate.service deploy/cpminiapp-logrotate.timer
backup="/root/cpminiapp-logging-config-$(date -u +%Y%m%d-%H%M%SZ)"
install -d -m 0700 "$backup"
cp -a /etc/nginx/sites-enabled/cpminiapp "$backup/nginx-cpminiapp.conf"
install -d -o www-data -g adm -m 0750 /var/log/cpminiapp-nginx
install -m 0644 deploy/nginx-cpminiapp-observability.conf /etc/nginx/conf.d/cpminiapp-observability.conf
install -m 0644 deploy/nginx-cpminiapp.conf /etc/nginx/sites-enabled/cpminiapp
if ! nginx -t; then
  cp "$backup/nginx-cpminiapp.conf" /etc/nginx/sites-enabled/cpminiapp
  exit 1
fi
install -m 0644 deploy/cpminiapp-logrotate.conf /etc/cpminiapp-logrotate.conf
install -m 0644 deploy/cpminiapp-logrotate.service /etc/systemd/system/cpminiapp-logrotate.service
install -m 0644 deploy/cpminiapp-logrotate.timer /etc/systemd/system/cpminiapp-logrotate.timer
/usr/sbin/logrotate --debug --state /var/lib/logrotate/cpminiapp.status /etc/cpminiapp-logrotate.conf
install -d -m 0755 /etc/systemd/journald.conf.d
install -m 0644 deploy/cpminiapp-journald-retention.conf /etc/systemd/journald.conf.d/cpminiapp-retention.conf
systemctl daemon-reload
systemctl reload nginx
systemctl restart systemd-journald
# Apply the authorized retention to existing server journals as well as future records.
journalctl --rotate --vacuum-time=7d --vacuum-size=256M
systemctl enable --now cpminiapp-logrotate.timer
systemctl start cpminiapp-logrotate.service
systemctl restart cpminiapp-douyin
systemctl restart cpminiapp
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    systemctl is-active cpminiapp cpminiapp-douyin cpminiapp-logrotate.timer
    journalctl --disk-usage
    exit 0
  fi
  sleep 1
done
exit 1
