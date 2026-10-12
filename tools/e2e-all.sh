#!/bin/bash
# Run every area's e2e suite, one after another, against one server.
# Usage: tools/e2e-all.sh [base-url]   (default http://localhost:3000)
# Each suite resets and seeds the database in .env.local first (where it supports it).
# Every suite runs through tools/csp_run.py: a page that breaks the Content-Security-Policy fails it
# (exit 3 when the suite itself passed). The violations are in .data/e2e/<suite>.csp.jsonl.
BASE=${1:-http://localhost:3000}
export PATH="$HOME/nodejs22/bin:$PATH"
cd "$(dirname "$0")/.."
LOG=.data/e2e; mkdir -p $LOG
pass=0; fail=0
for area in ${AREAS:-public auth-account client-booking messaging-support partner-onboarding partner-ops partner-catalogue admin-ops admin-money journey-booking journey-cancel journey-dispute journey-partner}; do
  npm run db:reset >/dev/null 2>&1 && npm run db:seed >/dev/null 2>&1
  # Suites reset their own database where they can; here the runner has just reset it.
  extra=""; [ "$area" = "admin-ops" ] && extra="--reseed"; case "$area" in client-booking|journey-*) extra="--no-reset";; esac
  start=$(date +%s)
  rm -f $LOG/$area.csp.jsonl
  if CSP_LOG=$LOG/$area.csp.jsonl python3 tools/csp_run.py tests/e2e/$area.py --base "$BASE" $extra > $LOG/$area.log 2>&1; then r=PASS; pass=$((pass+1)); else r=FAIL; fail=$((fail+1)); fi
  echo "$r $area ($(( $(date +%s) - start ))s) — $(grep -v '^CSP: ' $LOG/$area.log | tail -1 | cut -c1-140) · $(grep '^CSP: ' $LOG/$area.log | tail -1 | cut -c1-60)"
done
echo "DONE: $pass passed, $fail failed"
