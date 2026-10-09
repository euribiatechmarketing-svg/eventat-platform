#!/bin/bash
# Run every area's e2e suite, one after another, against one server.
# Usage: tools/e2e-all.sh [base-url]   (default http://localhost:3000)
# Each suite resets and seeds the database in .env.local first (where it supports it).
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
  if python3 tests/e2e/$area.py --base "$BASE" $extra > $LOG/$area.log 2>&1; then r=PASS; pass=$((pass+1)); else r=FAIL; fail=$((fail+1)); fi
  echo "$r $area ($(( $(date +%s) - start ))s) — $(tail -1 $LOG/$area.log | cut -c1-160)"
done
echo "DONE: $pass passed, $fail failed"
