#!/usr/bin/env bash
set -euo pipefail
base="http://localhost:8080/api"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
curl -fsS --retry 15 --retry-connrefused --retry-delay 1 "$base/health" >/dev/null
printf 'NexDrive smoke test\n' > "$temp/upload.txt"
curl -fsS -c "$temp/cookies" -H 'Content-Type: application/json' \
 -d '{"name":"Test Admin","email":"admin@nexdrive.test","password":"a-very-long-test-password","bootstrapToken":"local-ci-setup-token-longer-than-twenty-four"}' \
 "$base/auth/register" > "$temp/register.json"
me="$(curl -fsS -b "$temp/cookies" "$base/auth/me")"
wid="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).workspaces[0].id)' "$me")"
origin="Origin: http://localhost:8080"
folder="$(curl -fsS -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"name":"Reports"}' "$base/workspaces/$wid/folders")"
fid="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$folder")"
file="$(curl -fsS -b "$temp/cookies" -H "$origin" -F "file=@$temp/upload.txt" \
 "$base/workspaces/$wid/upload?parentId=$fid")"
id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$file")"
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/download" > "$temp/downloaded.txt"
cmp "$temp/upload.txt" "$temp/downloaded.txt"
share="$(curl -fsS -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"days":1}' "$base/workspaces/$wid/nodes/$id/shares")"
url="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).url)' "$share")"
curl -fsS "$url" > "$temp/shared.txt"
cmp "$temp/upload.txt" "$temp/shared.txt"
key="$(curl -fsS -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"name":"Test integration","permission":"read"}' "$base/workspaces/$wid/api-keys")"
token="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).token)' "$key")"
curl -fsS -H "Authorization: Bearer $token" "$base/workspaces/$wid/nodes" >/dev/null
echo 'NexDrive API smoke test passed'
