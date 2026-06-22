#!/usr/bin/env bash
# Drive the WFIT dev dashboard through a scripted stress scenario and print the
# JSON results — a reproducible CLI harness on top of the dashboard's HTTP API.
#
# Prereq: the app must be running with the dashboard, e.g.
#   npm run tauri:dev:dash      (serves http://127.0.0.1:8848)
#
# Usage: scripts/stress.sh [PORT]            (default port 8848)
#   Override the scenario with env vars:
#   BURST_N=12 BENCH_N=30 SIM_FILL=100 scripts/stress.sh
#
# It is non-destructive by default (faults → burst → bench → reset). Set
# RUN_SIMULATE=1 to also replace the inventory via /stress/simulate (snapshots the
# DB first), and RUN_FULLSYNC=1 to run a full launch sync (slow, hits the network).
set -euo pipefail

PORT="${1:-8848}"
BASE="http://127.0.0.1:${PORT}"
BURST_N="${BURST_N:-8}"
BENCH_N="${BENCH_N:-20}"
SIM_FILL="${SIM_FILL:-100}"

req() { # METHOD PATH [JSON]
  curl -s -X "$1" "${BASE}$2" -H 'content-type: application/json' ${3:+-d "$3"}
  echo
}

echo "==> dashboard at ${BASE}"
if ! curl -sf "${BASE}/api/metrics" >/dev/null; then
  echo "!! dashboard not reachable — start it with: npm run tauri:dev:dash" >&2
  exit 1
fi

echo "==> baseline metrics"; req GET /api/metrics

echo "==> arm faults (latency 250ms, 25% 429, 10% outlier price)"
req POST /api/faults '{"enabled":true,"extra_latency_ms":250,"p429_pct":25,"malformed_price_pct":10}'

echo "==> market burst (n=${BURST_N})"
req POST /api/stress/market-burst "{\"n\":${BURST_N},\"kind\":\"orders\"}"

echo "==> valuation bench (n=${BENCH_N})"
req POST /api/stress/valuation-bench "{\"n\":${BENCH_N}}"

if [[ "${RUN_SIMULATE:-0}" == "1" ]]; then
  echo "==> simulate inventory (fill=${SIM_FILL}%) — REPLACES inventory (DB snapshotted first)"
  req POST /api/stress/simulate "{\"fill\":${SIM_FILL}}"
fi

if [[ "${RUN_FULLSYNC:-0}" == "1" ]]; then
  echo "==> full launch sync (slow, network)"
  req POST /api/stress/full-sync
fi

echo "==> reset faults"
req POST /api/faults '{}'

echo "==> final metrics"; req GET /api/metrics
echo "==> done."
