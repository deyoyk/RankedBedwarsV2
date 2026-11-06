#!/bin/sh
set -e

# Pterodactyl sets NODE_ENV=production on many eggs. The build needs
# devDependencies (tsup/typescript), so include them explicitly.
npm install --include=dev --no-audit --no-fund
npm run build
exec npm start
