#!/bin/sh
set -e

npm install --include=dev --no-audit --no-fund
npm run build
exec npm start
