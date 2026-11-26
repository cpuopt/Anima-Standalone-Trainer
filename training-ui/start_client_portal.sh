#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Starting Anima Client Portal (Independent Port Service)..."

if [ ! -d "node_modules" ]; then
    echo "node_modules not found. Installing dependencies..."
    npm ci
fi

PORTAL_PORT="${1:-${CLIENT_PORTAL_PORT:-3100}}"
node client-portal-server.js --port="$PORTAL_PORT"

echo ""
echo "Client Portal exited (check for errors above)."
