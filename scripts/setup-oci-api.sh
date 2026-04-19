#!/bin/bash
# PackFinder API setup for Oracle Cloud ARM (aarch64).
# Run this ON the OCI instance: bash setup-oci-api.sh
# Idempotent — safe to re-run to update the deployment.
set -e

REPO_URL="https://github.com/in-fused/teeceegee-hero.git"
BRANCH="packfinder-api"   # stable branch; change if needed
APP_DIR="$HOME/packfinder-api"
SERVICE_NAME="packfinder-api"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   PackFinder API — OCI ARM Setup         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Node.js ──────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -e 'process.exit(+process.version.slice(1).split(".")[0] < 20)')" ]]; then
  echo "=== Installing Node.js 20 ==="
  if command -v dnf &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo dnf install -y nodejs
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
fi
echo "Node $(node --version) / npm $(npm --version)"

# ── Clone or update repo ──────────────────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  echo "=== Updating existing repo ==="
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo "=== Cloning repo ==="
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ── .env file ────────────────────────────────────────────────────────────────
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo ""
  echo "=== Creating .env (you will be prompted for values) ==="
  echo ""

  read -rp "DATABASE_URL (e.g. postgresql://user:pass@localhost:5432/packfinder): " DB_URL
  while [[ -z "$DB_URL" ]]; do
    echo "DATABASE_URL is required."
    read -rp "DATABASE_URL: " DB_URL
  done

  read -rp "ADMIN_SECRET (make up a strong password for /admin routes): " ADMIN_SECRET
  while [[ -z "$ADMIN_SECRET" ]]; do
    echo "ADMIN_SECRET is required."
    read -rp "ADMIN_SECRET: " ADMIN_SECRET
  done

  read -rp "SCRAPLING_API_SECRET (shared secret for the proxy, or press Enter to skip): " SCRAPLING_SECRET

  cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=$DB_URL
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
ADMIN_SECRET=$ADMIN_SECRET
SCRAPLING_API_URL=http://localhost:8787
${SCRAPLING_SECRET:+SCRAPLING_API_SECRET=$SCRAPLING_SECRET}
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF

  echo ".env written to $APP_DIR/.env"
else
  echo "=== .env already exists — skipping (edit $APP_DIR/.env manually to change values) ==="
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== Installing dependencies and building ==="
cd "$APP_DIR"
npm ci --include=dev
npm run build
cp -r src/db/migrations dist/src/db/migrations

# ── Migrate ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Running database migrations ==="
node dist/src/db/migrate.js

# ── Systemd service ───────────────────────────────────────────────────────────
CURRENT_USER=$(whoami)
NODE_BIN=$(which node)
PATCHED_SERVICE="/tmp/${SERVICE_NAME}.service"

cat > "$PATCHED_SERVICE" <<EOF
[Unit]
Description=PackFinder API
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN dist/src/server.js
Restart=always
RestartSec=5
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

sudo cp "$PATCHED_SERVICE" /etc/systemd/system/${SERVICE_NAME}.service
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# ── Firewall ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Opening port 3000 in OS firewall ==="
if command -v firewall-cmd &>/dev/null; then
  sudo firewall-cmd --permanent --add-port=3000/tcp
  sudo firewall-cmd --reload
elif command -v ufw &>/dev/null; then
  sudo ufw allow 3000/tcp
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  API is running!                                         ║"
echo "║                                                          ║"
echo "║  Check status: sudo systemctl status packfinder-api      ║"
echo "║  View logs:    sudo journalctl -u packfinder-api -f      ║"
echo "║  Health check: curl http://localhost:3000/health         ║"
echo "║                                                          ║"
echo "║  IMPORTANT: Also open port 3000 in OCI Console:         ║"
echo "║  Networking → VCN → Security Lists → Add Ingress Rule   ║"
echo "║  Source: 0.0.0.0/0  Protocol: TCP  Port: 3000           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "After the API is confirmed healthy, populate the database:"
echo "  cd $APP_DIR"
echo "  npm run ingest:zip"
echo "  npm run ingest:stores"
echo "  npm run ingest:tcgcsv"
