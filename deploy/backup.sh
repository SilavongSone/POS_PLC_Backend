#!/bin/sh
# Nightly pg_dump (custom format, restorable with pg_restore). Runs forever in the
# backup container; copies in ./backups should also be synced off the server.
set -eu
mkdir -p /backups
while true; do
  # Sleep until the next 02:00 local time.
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 02:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  file="/backups/plc_pos-$(date +%Y%m%d-%H%M).dump"
  if pg_dump --format=custom --file="$file.part"; then
    mv "$file.part" "$file"
    echo "backup: wrote $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "backup: pg_dump failed" >&2
  fi
  find /backups -name 'plc_pos-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
done
