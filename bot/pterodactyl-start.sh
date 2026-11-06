#!/bin/sh
set -e

npm install --include=dev --no-audit --no-fund
exec npm start
