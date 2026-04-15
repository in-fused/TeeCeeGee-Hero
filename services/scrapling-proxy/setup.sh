#!/bin/bash
# Setup script for the Scrapling proxy on Oracle Cloud ARM (aarch64).
# Works on any Linux host: Oracle Linux (opc user), Ubuntu (ubuntu user), etc.

set -e

# ── Detect architecture ─────────────────────────────────────────────────────
ARCH=$(uname -m)
echo "=== Detected architecture: $ARCH ==="

if [[ "$ARCH" != "aarch64" && "$ARCH" != "x86_64" ]]; then
  echo "WARNING: Untested architecture '$ARCH' — proceeding anyway"
fi

# ── Python / pip setup ──────────────────────────────────────────────────────
# Oracle Cloud ARM instances often ship with Python 3.9+. Ensure pip is available.
if ! command -v pip3 &>/dev/null; then
  echo "=== Installing pip ==="
  if command -v dnf &>/dev/null; then
    sudo dnf install -y python3-pip            # Oracle Linux / RHEL
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y python3-pip        # Ubuntu / Debian
  else
    echo "ERROR: cannot find dnf or apt-get — install pip3 manually"
    exit 1
  fi
fi

# ── Install Python dependencies ─────────────────────────────────────────────
echo "=== Installing Python dependencies ==="
pip3 install --upgrade pip
pip3 install -r requirements.txt

# Note: scrapling[all] pulls in playwright as an optional dep. On ARM64 the
# Playwright Chromium binary is NOT available, but we only use StealthyFetcher
# (Camoufox / Firefox-based) which *does* have an aarch64 build — so that's fine.

# ── Install Camoufox browser ────────────────────────────────────────────────
echo "=== Installing Scrapling browser (Camoufox) ==="
echo "    Camoufox supports aarch64 — downloading ARM64 binary..."
python3 -m scrapling install
# Or equivalently: scrapling install
# This downloads the correct build for your architecture automatically.

# ── Systemd service file ────────────────────────────────────────────────────
echo ""
echo "=== Detecting current user for systemd service ==="
CURRENT_USER=$(whoami)
SERVICE_FILE="scrapling-proxy.service"
PATCHED_FILE="/tmp/scrapling-proxy-patched.service"

sed "s/User=ubuntu/User=${CURRENT_USER}/" "$SERVICE_FILE" > "$PATCHED_FILE"
sed -i "s|WorkingDirectory=/home/ubuntu/scrapling-proxy|WorkingDirectory=$(pwd)|" "$PATCHED_FILE"
sed -i "s|ExecStart=/usr/bin/python3|ExecStart=$(which python3)|" "$PATCHED_FILE"

echo "    Service will run as: ${CURRENT_USER}"
echo "    WorkingDirectory:    $(pwd)"
echo "    Python:              $(which python3)"

echo ""
echo "=== Setup complete ==="
echo ""
echo "To test manually (no systemd):"
echo "  python3 server.py"
echo ""
echo "To install as a systemd service:"
echo "  sudo cp $PATCHED_FILE /etc/systemd/system/scrapling-proxy.service"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now scrapling-proxy"
echo "  sudo systemctl status scrapling-proxy"
echo ""
echo "Then set these env vars on your Render PackFinder API:"
echo "  SCRAPLING_API_URL=http://YOUR_ORACLE_CLOUD_IP:8787"
echo "  SCRAPLING_API_SECRET=your-shared-secret"
echo ""
echo "Oracle Cloud firewall note:"
echo "  Open port 8787 in both:"
echo "  1. OCI Console → Networking → VCN → Security List → Add Ingress Rule"
echo "     Source: 0.0.0.0/0 (or Render's IP), Dest Port: 8787, Protocol: TCP"
echo "  2. OS-level firewall (firewalld on Oracle Linux):"
echo "     sudo firewall-cmd --permanent --add-port=8787/tcp"
echo "     sudo firewall-cmd --reload"
echo "  (Ubuntu uses ufw: sudo ufw allow 8787/tcp)"
