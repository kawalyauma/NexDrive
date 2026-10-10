#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo "ERROR: .env is missing. Copy .env.example first." >&2; exit 1; fi
get_value() {
  grep -m1 "^$1=" .env | cut -d= -f2- | tr -d '\r'
}
check_secret(){
 local name="$1" min="$2" secret
 secret="$(get_value "$name")"
 if [ "${#secret}" -lt "$min" ] || [[ "$secret" == *change-this* ]]; then
  echo "ERROR: $name must be a unique random secret with at least $min characters." >&2
  exit 1
 fi
}
check_secret POSTGRES_PASSWORD 24
check_secret SESSION_SECRET 32
check_secret BOOTSTRAP_TOKEN 24
origin="$(get_value PUBLIC_ORIGIN)"
domain="$(get_value DOMAIN)"
if [[ "$origin" != https://* ]] || [[ "$origin" == */ ]]; then
 echo "ERROR: PUBLIC_ORIGIN must be your HTTPS origin without trailing slash." >&2; exit 1
fi
if [ "$origin" != "https://$domain" ]; then
 echo "ERROR: DOMAIN and PUBLIC_ORIGIN must refer to the same hostname." >&2; exit 1
fi
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
 echo "ERROR: Docker Engine and Docker Compose are required." >&2; exit 1
fi
docker compose -f docker-compose.yml -f compose.proxy.yml config --quiet
echo "NexDrive preflight passed. Check DNS, firewall, disk space and offsite backups before public launch."
