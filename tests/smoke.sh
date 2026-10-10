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
# Access checks: users and app integrations must not bypass workspace permissions.
expect_status(){
 local expected="$1"; shift
 local actual
 actual="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
 if [ "$actual" != "$expected" ]; then
  echo "Expected HTTP $expected, received $actual" >&2
  return 1
 fi
}
expect_status 401 "$base/workspaces/$wid/nodes"
expect_status 403 -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
 -d '{"name":"Denied"}' "$base/workspaces/$wid/folders"
expect_status 403 -H 'Content-Type: application/json' \
 -d '{"name":"Unexpected User","email":"unexpected@nexdrive.test","password":"another-long-password"}' \
 "$base/auth/register"
expect_status 403 -b "$temp/cookies" -H 'Origin: https://untrusted.example' \
 -H 'Content-Type: application/json' -d '{"name":"Denied"}' "$base/workspaces/$wid/folders"

# A public file link expires immediately when revoked.
curl -fsS -X DELETE -b "$temp/cookies" -H "$origin" \
 "$base/workspaces/$wid/nodes/$id/shares" >/dev/null
expect_status 404 "$url"

# Trash blocks download; restore brings the file back.
curl -fsS -X POST -b "$temp/cookies" -H "$origin" \
 "$base/workspaces/$wid/nodes/$id/trash" >/dev/null
expect_status 404 -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/download"
curl -fsS -X POST -b "$temp/cookies" -H "$origin" \
 "$base/workspaces/$wid/nodes/$id/restore" >/dev/null
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/download" > "$temp/restored.txt"
cmp "$temp/upload.txt" "$temp/restored.txt"
echo 'NexDrive API smoke test passed'
