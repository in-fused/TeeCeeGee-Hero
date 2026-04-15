#!/usr/bin/env bash
set -euo pipefail

# Run this ONCE after first deploy to populate the database.
# You can run it from Render's Shell tab, or locally with DATABASE_URL set.

echo "=== Step 1/3: Loading US ZIP code centroids ==="
npm run ingest:zip

echo "=== Step 2/3: Loading TCG-relevant stores from OpenStreetMap ==="
npm run ingest:stores

echo "=== Step 3/3: Loading Pokemon + One Piece products ==="
npm run ingest:tcgcsv

echo ""
echo "=== All data loaded. Verify with: ==="
echo "  curl https://YOUR-APP.onrender.com/health"
echo "  curl https://YOUR-APP.onrender.com/connectors/health"
echo "  curl 'https://YOUR-APP.onrender.com/search?zip=90210&radius=15'"
