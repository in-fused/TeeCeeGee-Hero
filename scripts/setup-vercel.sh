#!/usr/bin/env bash
# Deploy the PackFinder web frontend to Vercel.
# Run from the repo root: bash scripts/setup-vercel.sh
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   PackFinder → Vercel (Frontend Setup)   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Install Vercel CLI if missing ─────────────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  echo "Installing Vercel CLI..."
  npm install -g vercel
fi

# ── Gather values ──────────────────────────────────────────────────────────────
echo "Enter your values (you can update these in the Vercel dashboard later):"
echo ""
read -rp "API URL — your Railway/Render API URL, e.g. https://packfinder-api.up.railway.app : " API_URL
read -rp "ADMIN_SECRET — same password you set (or will set) on the API              : " ADMIN_SECRET
echo ""

# ── Login ──────────────────────────────────────────────────────────────────────
echo "Opening Vercel login (browser will open)..."
vercel login

# ── Deploy ─────────────────────────────────────────────────────────────────────
echo ""
echo "Deploying frontend from web/..."
cd "$(dirname "$0")/../web"

vercel --prod \
  --build-env VITE_API_URL="$API_URL" \
  --build-env VITE_ADMIN_SECRET="$ADMIN_SECRET"

echo ""
echo "✓ Frontend deployed to Vercel."
echo ""
echo "To update env vars later: vercel.com → your project → Settings → Environment Variables"
