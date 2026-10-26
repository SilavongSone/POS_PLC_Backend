#!/bin/bash
# Load-tests key endpoints against a benchmark database. See docs/operations.md.
#
#   createdb plc_pos_bench && DATABASE_URL=…/plc_pos_bench npx prisma migrate deploy && npx prisma db seed
#   psql …/plc_pos_bench -f scripts/bench/bench-data.sql   # 10k products, 5k customers, 50k sales
#   pnpm build && BENCH_DB=plc_pos_bench scripts/bench/run.sh "label"
cd "$(dirname "$0")/../.."
export DATABASE_URL="postgresql://${BENCH_DB_USER:-plc}:${BENCH_DB_PASSWORD:-plc}@${BENCH_DB_HOST:-localhost}:5432/${BENCH_DB:-plc_pos_bench}?schema=public" \
  LOG_LEVEL=silent PORT=4100 THROTTLE_LIMIT=1000000 NODE_ENV=production
AC="npx --yes autocannon@7.15.0"
node dist/main.js > /dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s localhost:4100/api/health >/dev/null && break; sleep 0.5; done
B=http://localhost:4100/api
TOK=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"${BENCH_ADMIN_PASSWORD:-admin1234}\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['accessToken'])")
load() { # 10 connections for 8 s
  $AC -c 10 -d 8 -j -H "Authorization=Bearer $TOK" -H "Accept-Encoding=gzip" "$2" 2>/dev/null \
   | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"| $1 | {d['requests']['average']:.0f} req/s | {d['latency']['p50']} ms | {d['latency']['p99']} ms |\")"
}
single() { # best of 3 single requests
  best=999999
  for i in 1 2 3; do
    t=$(curl -s -o /dev/null -m 120 -w "%{time_total}" -H "Authorization: Bearer $TOK" "$2")
    best=$(python3 -c "print(min($best, $t*1000))")
  done
  echo "| $1 | single request | ${best%.*} ms | |"
}
echo "== ${1:-run}"
echo "| endpoint | throughput | p50 | p99 |"
load "products search q=printer" "$B/products?q=printer&pageSize=20"
load "products search q=model 77" "$B/products?q=model%2077"
load "scan lookup (barcode)" "$B/products/lookup?code=9900000005000"
load "customers search" "$B/customers?q=customer%2012"
load "customers list (20, with debt)" "$B/customers?pageSize=20"
load "sales list (20)" "$B/sales?pageSize=20"
single "report: sales summary, 1 month by day" "$B/reports/sales-summary?groupBy=day&from=$(date -d '-30 days' +%F)&to=$(date +%F)"
single "report: sales summary, 1 year by month" "$B/reports/sales-summary?groupBy=month&from=$(date -d '-1 year' +%F)&to=$(date +%F)"
single "report: debt aging" "$B/reports/debt-aging"
