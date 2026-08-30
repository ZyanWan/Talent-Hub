#!/usr/bin/env bash
set -euo pipefail

EXECUTABLE="${1:?Usage: verify_macos_release.sh <path-to-executable>}"
if [[ ! -x "$EXECUTABLE" ]]; then
  echo "Executable not found or not executable: $EXECUTABLE" >&2
  exit 1
fi

if [[ -n "${TALENT_HUB_VERIFY_PORT:-}" ]]; then
  PORT="$TALENT_HUB_VERIFY_PORT"
else
  PORT="$(python - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)"
fi

DATA_DIR="$(mktemp -d -t talenthub-verify-XXXXXX)"
LOG_FILE="$DATA_DIR/app.log"

cleanup() {
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

"$EXECUTABLE" --no-browser --port "$PORT" --data-dir "$DATA_DIR" >"$LOG_FILE" 2>&1 &
PID="$!"

for _ in {1..100}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "App exited during startup. Log:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
  HEALTH="$(/usr/bin/curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null || true)"
  if [[ "$HEALTH" == *'"app":"talent-hub"'* && "$HEALTH" == *'"status":"ok"'* ]]; then
    PAGE="$(/usr/bin/curl -fsS "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
    if [[ "$PAGE" == *'class="app-shell"'* ]]; then
      echo "macOS release smoke test passed: $EXECUTABLE"
      exit 0
    fi
  fi
  sleep 0.3
done

echo "macOS release smoke test failed. Log:" >&2
cat "$LOG_FILE" >&2
exit 1
