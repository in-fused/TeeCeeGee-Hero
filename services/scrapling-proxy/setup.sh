#!/bin/bash
# Quick setup script for the Scrapling proxy on EC2.
# Run this on your EC2 instance where scrapling is already installed.

set -e

echo "=== Installing dependencies ==="
pip install -r requirements.txt

echo "=== Installing Scrapling browser (Camoufox) ==="
scrapling install

echo ""
echo "=== Setup complete ==="
echo ""
echo "To start the service:"
echo "  python server.py"
echo ""
echo "Or run in background with:"
echo "  nohup python server.py > scrapling-proxy.log 2>&1 &"
echo ""
echo "Or use systemd (recommended for production):"
echo "  sudo cp scrapling-proxy.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable --now scrapling-proxy"
echo ""
echo "Then set on your Render PackFinder API:"
echo "  SCRAPLING_API_URL=http://YOUR_EC2_IP:8787"
echo "  SCRAPLING_API_SECRET=your-shared-secret  (optional)"
