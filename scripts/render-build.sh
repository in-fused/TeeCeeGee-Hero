#!/usr/bin/env bash
set -euo pipefail

echo "=== Installing dependencies ==="
npm ci

echo "=== Building TypeScript ==="
npm run build

echo "=== Running migrations ==="
npm run migrate

echo "=== Build complete ==="
