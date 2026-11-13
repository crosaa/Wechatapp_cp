#!/usr/bin/env bash
set -euo pipefail
cd /opt/cpminiapp
chmod 0644 server/server.mjs server/douyin-stock.mjs server/douyin-catalog.mjs \
  server/douyin-schedule.mjs server/douyin-schedule.test.mjs server/douyin-worker.mjs \
  server/douyin-worker-client.mjs server/public/admin/app.js server/public/admin/index.html \
  scripts/run-douyin-scheduled-sync.mjs deploy/cpminiapp-douyin.service \
  deploy/cpminiapp-douyin-sync.service deploy/cpminiapp-douyin-sync.timer
node --check server/server.mjs
node --check server/douyin-worker.mjs
node --check server/douyin-stock.mjs
node --check server/public/admin/app.js
node server/douyin-schedule.test.mjs
systemd-analyze verify deploy/cpminiapp-douyin.service deploy/cpminiapp-douyin-sync.service deploy/cpminiapp-douyin-sync.timer
install -o root -g root -m 0644 deploy/cpminiapp-douyin.service /etc/systemd/system/cpminiapp-douyin.service
install -o root -g root -m 0644 deploy/cpminiapp-douyin-sync.service /etc/systemd/system/cpminiapp-douyin-sync.service
install -o root -g root -m 0644 deploy/cpminiapp-douyin-sync.timer /etc/systemd/system/cpminiapp-douyin-sync.timer
systemctl daemon-reload
# Stop the old in-process scheduler before starting a worker that uses the same browser profile/state.
systemctl stop cpminiapp
systemctl enable --now cpminiapp-douyin.service
systemctl start cpminiapp
systemctl enable --now cpminiapp-douyin-sync.timer
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    systemctl is-active cpminiapp cpminiapp-douyin cpminiapp-douyin-sync.timer
    systemctl list-timers cpminiapp-douyin-sync.timer --no-pager
    exit 0
  fi
  sleep 1
done
systemctl status cpminiapp --no-pager
exit 1
