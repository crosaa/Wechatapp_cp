#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/tmp/cpminiapp-maintenance-20260726.tar.gz}"
app_dir="/opt/cpminiapp"
data_dir="/var/lib/cpminiapp/data"
backup_dir="${data_dir}/backups"
timestamp="$(date -u +%Y%m%d-%H%M%SZ)"

test -f "${archive}"
install -d -o cpminiapp -g cpminiapp -m 0750 "${backup_dir}"

tar -czf "/root/cpminiapp-code-before-maintenance-${timestamp}.tar.gz" \
  -C "${app_dir}" server/server.mjs server/db.mjs package.json

runuser -u cpminiapp -- env \
  CATALOG_SOURCE="${data_dir}/catalog.db" \
  CATALOG_BACKUP="${backup_dir}/catalog-pre-maintenance-${timestamp}.db" \
  node --input-type=module <<'NODE'
import * as sqlite from 'node:sqlite'
const source = new sqlite.DatabaseSync(process.env.CATALOG_SOURCE)
const target = process.env.CATALOG_BACKUP
if (typeof sqlite.backup === 'function') {
  await sqlite.backup(source, target)
} else {
  source.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
}
source.close()
NODE

tar -xzf "${archive}" -C "${app_dir}"
chown root:root \
  "${app_dir}/server/server.mjs" \
  "${app_dir}/server/db.mjs" \
  "${app_dir}/server/test.mjs" \
  "${app_dir}/scripts/daily-maintenance.mjs" \
  "${app_dir}/deploy/cpminiapp-maintenance.service" \
  "${app_dir}/deploy/cpminiapp-maintenance.timer" \
  "${app_dir}/package.json" \
  "${app_dir}/README.md"
chmod 0644 \
  "${app_dir}/server/server.mjs" \
  "${app_dir}/server/db.mjs" \
  "${app_dir}/server/test.mjs" \
  "${app_dir}/scripts/daily-maintenance.mjs" \
  "${app_dir}/deploy/cpminiapp-maintenance.service" \
  "${app_dir}/deploy/cpminiapp-maintenance.timer" \
  "${app_dir}/package.json" \
  "${app_dir}/README.md"

find "${data_dir}" -maxdepth 1 -type f -name 'catalog.backup*.db' -exec mv -n {} "${backup_dir}/" \;
chown -R cpminiapp:cpminiapp "${backup_dir}"

install -o root -g root -m 0644 "${app_dir}/deploy/cpminiapp-maintenance.service" /etc/systemd/system/cpminiapp-maintenance.service
install -o root -g root -m 0644 "${app_dir}/deploy/cpminiapp-maintenance.timer" /etc/systemd/system/cpminiapp-maintenance.timer
systemctl daemon-reload
systemctl restart cpminiapp

for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
    echo "Application restarted successfully"
    exit 0
  fi
  sleep 1
done

systemctl status cpminiapp --no-pager
exit 1
