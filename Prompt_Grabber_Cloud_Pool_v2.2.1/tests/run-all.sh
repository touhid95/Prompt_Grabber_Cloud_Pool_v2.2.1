#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for file in "$ROOT"/*.js; do
  node --check "$file" >/dev/null
  echo "syntax: PASS $(basename "$file")"
done

node "$ROOT/tests/cloud-client.test.mjs"
node "$ROOT/tests/static-integrity.mjs"
node "$ROOT/tests/seed-data.test.mjs"

echo "all local tests: PASS"
