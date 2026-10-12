#!/usr/bin/env bash
# stripe-mock — Stripe's official mock API server (github.com/stripe/stripe-mock) — for the
# tests in tests/payments. Downloads the pinned release into .tools/ (gitignored) once, checks its
# SHA-256 against the hash pinned below, and runs it on 127.0.0.1 with -strict-version-check, so it
# answers only the API version its spec describes. Keep VERSION in step with the stripe package: the
# test "stripe-mock speaks the API version the SDK pins" fails when they drift apart.
#
#   tools/stripe-mock.sh          # http://127.0.0.1:12111, where the tests look by default
#   tools/stripe-mock.sh 12611    # another port; then STRIPE_MOCK_URL=http://127.0.0.1:12611 npm test
set -euo pipefail

VERSION=0.206.0 # API 2026-09-30.endive = stripe@23.0.0
PORT="${1:-12111}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.tools/stripe-mock-$VERSION"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  ASSET=darwin_arm64; SHA=a476275b472d8e2b12e9a9d0d7815afb5042b13474d282e0addb7cd7ba3dc6d2 ;;
  Darwin-x86_64) ASSET=darwin_amd64; SHA=bfe2cd0d5da86fb822f3d188d091d8af4c6074ce21b40a89eb08995ef2ff1e93 ;;
  Linux-x86_64)  ASSET=linux_amd64;  SHA=b6fe5a8f02aaeb5a5001710b304fc93a222f1983a9a6050a38f55cfdc48b8d19 ;;
  Linux-aarch64|Linux-arm64) ASSET=linux_arm64; SHA=4211996f385e09a3705d3e7579134c520255261f442d804da0ac0ec7bd39f252 ;;
  *) echo "stripe-mock.sh: no release for $(uname -s) $(uname -m); see github.com/stripe/stripe-mock" >&2; exit 1 ;;
esac

if [ ! -x "$DIR/stripe-mock" ]; then
  TAR="stripe-mock_${VERSION}_${ASSET}.tar.gz"
  mkdir -p "$DIR"
  echo "Downloading stripe-mock $VERSION ($ASSET)…" >&2
  curl -fsSL -o "$DIR/$TAR" "https://github.com/stripe/stripe-mock/releases/download/v$VERSION/$TAR"
  GOT="$(shasum -a 256 "$DIR/$TAR" | cut -d' ' -f1)"
  if [ "$GOT" != "$SHA" ]; then
    rm -f "$DIR/$TAR"
    echo "stripe-mock.sh: checksum mismatch for $TAR (got $GOT, expected $SHA)" >&2
    exit 1
  fi
  tar -xzf "$DIR/$TAR" -C "$DIR" stripe-mock
  rm -f "$DIR/$TAR"
fi

# HTTP on the port asked for; its HTTPS listener (always on with -http-addr) on a free local port, never on the network.
exec "$DIR/stripe-mock" -http-addr "127.0.0.1:$PORT" -https-addr 127.0.0.1:0 -strict-version-check
