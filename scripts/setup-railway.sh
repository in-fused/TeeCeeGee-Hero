#!/usr/bin/env bash
# Deploy the PackFinder API to Railway.
# Run from the repo root: bash scripts/setup-railway.sh
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║    PackFinder → Railway (API Setup)      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Install Railway CLI if missing ────────────────────────────────────────────
if ! command -v railway &>/dev/null; then
  echo "Installing Railway CLI..."
  npm install -g @railway/cli
fi

# ── Gather values ─────────────────────────────────────────────────────────────
echo "Enter your values (press Enter to skip optional ones):"
echo ""

read -rp "ADMIN_SECRET — make up a strong password for the /admin routes  : " ADMIN_SECRET
while [[ -z "$ADMIN_SECRET" ]]; do
  echo "ADMIN_SECRET cannot be empty."
  read -rp "ADMIN_SECRET: " ADMIN_SECRET
done

read -rp "SCRAPLING_API_URL — your OCI instance, e.g. http://1.2.3.4:8787 [optional]: " SCRAPLING_URL
read -rp "SCRAPLING_API_SECRET — shared secret for the OCI proxy              [optional]: " SCRAPLING_SECRET
read -rp "POKEMON_TCG_API_KEY — free at https://dev.pokemontcg.io/            [optional]: " POKEMON_KEY
echo ""

# ── Login ─────────────────────────────────────────────────────────────────────
echo "Opening Railway login (browser will open)..."
railway login

# ── Create project ────────────────────────────────────────────────────────────
echo ""
echo "Creating Railway project 'packfinder-api'..."
railway init --name packfinder-api

# ── Add PostgreSQL ────────────────────────────────────────────────────────────
echo "Adding PostgreSQL database..."
railway add --database postgresql
# Railway auto-injects DATABASE_URL into the project — no manual step needed.

# ── Set env vars ──────────────────────────────────────────────────────────────
echo "Setting environment variables..."

railway variables --set "NODE_ENV=production"
railway variables --set "LOG_LEVEL=info"
railway variables --set "RATE_LIMIT_WINDOW_MS=60000"
railway variables --set "RATE_LIMIT_MAX_REQUESTS=100"
railway variables --set "ADMIN_SECRET=$ADMIN_SECRET"

[[ -n "$SCRAPLING_URL" ]]    && railway variables --set "SCRAPLING_API_URL=$SCRAPLING_URL"
[[ -n "$SCRAPLING_SECRET" ]] && railway variables --set "SCRAPLING_API_SECRET=$SCRAPLING_SECRET"
[[ -n "$POKEMON_KEY" ]]      && railway variables --set "POKEMON_TCG_API_KEY=$POKEMON_KEY"

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "Deploying API (this takes ~2 minutes)..."
railway up --detach

echo ""
echo "✓ API deploying on Railway."
echo ""
echo "Next steps:"
echo "  1. Run 'railway open' to see your project dashboard"
echo "  2. Copy your API URL from the dashboard (Settings → Networking → Public URL)"
echo "  3. Paste it into Vercel as VITE_API_URL  (or re-run scripts/setup-vercel.sh)"
echo ""
echo "After the first deploy, populate the database from Railway shell (dashboard → Deploy → Connect):"
echo "  npm run ingest:zip"
echo "  npm run ingest:stores"
echo "  npm run ingest:tcgcsv"
