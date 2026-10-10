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
# Favorites are per-user.
curl -fsS -X POST -b "$temp/cookies" -H "$origin" "$base/workspaces/$wid/nodes/$id/star" >/dev/null
starred="$(curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/starred")"
node -e 'if(!JSON.parse(process.argv[1]).nodes.some(n=>n.id===process.argv[2]))process.exit(1)' "$starred" "$id"
curl -fsS -X DELETE -b "$temp/cookies" -H "$origin" "$base/workspaces/$wid/nodes/$id/star" >/dev/null

# Duplicate a file without losing its content.
copy="$(curl -fsS -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"name":"Copied report.txt"}' "$base/workspaces/$wid/nodes/$id/copy")"
copyId="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$copy")"
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$copyId/download" > "$temp/copied.txt"
cmp "$temp/upload.txt" "$temp/copied.txt"

# New revision does not erase the original; restoring keeps the history.
printf 'New version of NexDrive smoke test\n' > "$temp/updated.txt"
curl -fsS -b "$temp/cookies" -H "$origin" -F "file=@$temp/updated.txt" \
 "$base/workspaces/$wid/nodes/$id/versions" >/dev/null
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/download" > "$temp/current.txt"
cmp "$temp/updated.txt" "$temp/current.txt"
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/versions/1/download" > "$temp/v1.txt"
cmp "$temp/upload.txt" "$temp/v1.txt"
curl -fsS -X POST -b "$temp/cookies" -H "$origin" \
 "$base/workspaces/$wid/nodes/$id/versions/1/restore" >/dev/null
curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/download" > "$temp/restored_v1.txt"
cmp "$temp/upload.txt" "$temp/restored_v1.txt"

# Team invitation: a new member joins a workspace but cannot administer it.
invite="$(curl -fsS -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"email":"teammate@nexdrive.test","role":"member"}' "$base/workspaces/$wid/invitations")"
inviteToken="$(node -e 'process.stdout.write(new URL(JSON.parse(process.argv[1]).url).searchParams.get("invite"))' "$invite")"
node -e 'process.stdout.write(JSON.stringify({name:"Teammate",email:"teammate@nexdrive.test",password:"a-different-very-long-password",inviteToken:process.argv[1]}))' \
 "$inviteToken" > "$temp/invite-register.json"
curl -fsS -c "$temp/member-cookie" -H 'Content-Type: application/json' \
 --data-binary "@$temp/invite-register.json" "$base/auth/register" >/dev/null
curl -fsS -b "$temp/member-cookie" "$base/workspaces/$wid/nodes" >/dev/null
expect_status 403 -b "$temp/member-cookie" "$base/workspaces/$wid/members"
expect_status 403 -b "$temp/member-cookie" "$base/workspaces/$wid/activity"

# File metadata and sharing actions produce workspace audit entries.
events="$(curl -fsS -b "$temp/cookies" "$base/workspaces/$wid/activity")"
node -e 'if(!JSON.parse(process.argv[1]).events.some(e=>e.action==="file.uploaded"))process.exit(1)' "$events"
# Text files should not be embedded as web previews.
expect_status 415 -b "$temp/cookies" "$base/workspaces/$wid/nodes/$id/preview"
# Password rotation invalidates older cookies and issues a new session.
curl -fsS -c "$temp/rotated-cookie" -b "$temp/cookies" -H "$origin" -H 'Content-Type: application/json' \
 -d '{"currentPassword":"a-very-long-test-password","newPassword":"an-updated-strong-password"}' \
 "$base/auth/change-password" >/dev/null
expect_status 401 -b "$temp/cookies" "$base/auth/me"
curl -fsS -b "$temp/rotated-cookie" "$base/auth/me" >/dev/null
# Logout revokes the current JWT, even if an old cookie is replayed.
curl -fsS -X POST -b "$temp/rotated-cookie" -H "$origin" "$base/auth/logout" >/dev/null
expect_status 401 -b "$temp/rotated-cookie" "$base/auth/me"
echo 'NexDrive API smoke test passed'
