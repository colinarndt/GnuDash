#!/usr/bin/env bash
# Build the standalone server in /opt/gnudash/app. Run as the repo owner.
set -euo pipefail
cd "$(dirname "$0")/../../app"
export PATH="/opt/gnudash/node/bin:$PATH"
node --version
npm ci --no-audit --no-fund
npm run build
# `next build` leaves static assets outside the standalone bundle.
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
echo "built: $(pwd)/.next/standalone/server.js"
