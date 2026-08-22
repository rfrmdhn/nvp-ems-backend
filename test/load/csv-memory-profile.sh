#!/usr/bin/env bash
# CSV import memory profile: samples the `worker` container's RSS via
# `docker stats` while a large CSV import runs, to empirically verify the
# "never buffer the whole file" claim in EMS-BACKEND-PLAN.md §8 — this is
# item 6 from docs/superpowers/tests/csv-import.md's deferred load/stress
# list. If streaming/batching is working, memory should stay roughly flat
# regardless of file size, not grow with row count.
#
# Usage: ./test/load/csv-memory-profile.sh [rows] [csv-path]
#   rows      row count to generate if csv-path isn't supplied (default 25000)
#   csv-path  an existing CSV to upload instead of generating one
set -euo pipefail

cd "$(dirname "$0")/../.."

ROWS="${1:-25000}"
CSV_PATH="${2:-}"
BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@nusantaradigital.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"
WORKER_CONTAINER="${WORKER_CONTAINER:-ems-backend-worker-1}"

if [ -z "$CSV_PATH" ]; then
  CSV_PATH="scripts/generated-employees.csv"
  if [ ! -f "$CSV_PATH" ]; then
    node scripts/generate-large-csv.mjs "$ROWS" "$CSV_PATH"
  fi
fi

echo "Logging in..."
TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")

echo "Uploading $CSV_PATH..."
UPLOAD=$(curl -s -X POST "$BASE_URL/csv-import/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$CSV_PATH;type=text/csv")
JOB_ID=$(echo "$UPLOAD" | python3 -c "import json,sys;print(json.load(sys.stdin)['jobId'])")
echo "jobId=$JOB_ID — sampling '$WORKER_CONTAINER' RSS every 200ms until the job completes..."

echo "elapsed_ms,worker_mem_usage,worker_mem_perc"
START=$(date +%s%N)
while true; do
  NOW=$(date +%s%N)
  ELAPSED_MS=$(( (NOW - START) / 1000000 ))
  STATS=$(docker stats "$WORKER_CONTAINER" --no-stream --format '{{.MemUsage}},{{.MemPerc}}' 2>/dev/null || echo "n/a,n/a")
  echo "$ELAPSED_MS,$STATS"

  STATUS=$(curl -s "$BASE_URL/csv-import/$JOB_ID/status" -H "Authorization: Bearer $TOKEN")
  STATE=$(echo "$STATUS" | python3 -c "import json,sys;print(json.load(sys.stdin).get('state','?'))" 2>/dev/null || echo "?")
  if [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ]; then
    echo "# job settled: $STATUS"
    break
  fi
  sleep 0.2
done
