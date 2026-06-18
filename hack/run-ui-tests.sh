#!/usr/bin/env bash
# Run headless browser UI tests against klogster in demo mode.
# Usage: ./hack/run-ui-tests.sh [playwright args...]
#   e.g. ./hack/run-ui-tests.sh --headed          # show the browser
#        ./hack/run-ui-tests.sh --debug            # pause on first action
#        ./hack/run-ui-tests.sh tests/ui.spec.js   # run one file

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARY="/tmp/klogster-ui-test"
PORT="${KLOGSTER_PORT:-7071}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$BINARY"
}
trap cleanup EXIT

echo "==> Building klogster..."
cd "$REPO_ROOT"
go build -o "$BINARY" ./cmd

echo "==> Starting klogster in demo mode on port $PORT..."
"$BINARY" -demo -serve ":$PORT" &
SERVER_PID=$!

echo "==> Waiting for server to be ready..."
for _ in $(seq 1 40); do
  if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "ERROR: server process died" >&2
    exit 1
  fi
  sleep 0.25
done

if ! curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
  echo "ERROR: server did not become ready" >&2
  exit 1
fi
echo "==> Server ready at http://localhost:$PORT"

echo "==> Installing Playwright (if needed)..."
cd "$REPO_ROOT/hack"
npm install --silent
npx playwright install chromium --with-deps 2>/dev/null || \
  npx playwright install chromium

echo "==> Running UI tests..."
KLOGSTER_PORT="$PORT" npx playwright test "$@"
