# NexDrive

**NexDrive** is a self-hosted storage drive for people and trusted applications. React + TypeScript frontend, Fastify + TypeScript API, PostgreSQL metadata, and private local-disk file storage. Docker Compose is provided for a single Debian/Linux server.

## Included in this foundation

- Multi-user workspaces, owner/admin/member roles and 7-day email-matched invitations
- Folders, uploads, downloads, rename, move, search, trash, restore and permanent deletion
- Starred and recent files, copies, image/PDF previews and file revision history
- Member role management and basic workspace activity records
- Storage quotas, per-upload limits and private files by default
- 1–30 day downloadable links and revocable read/write API keys scoped to one workspace
- HttpOnly signed login sessions, Argon2id passwords, server-side authorizations
- Responsive browser file manager, settings and app integrations
- Docker deployment with optional HTTPS Caddy reverse proxy

## Deploy on your own Linux server

Prerequisites: Docker Engine with Compose plugin, a DNS name pointing to your server, ports 80/443 open, and persistent storage.

```bash
git clone https://github.com/kawalyauma/NexDrive.git
cd NexDrive
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, SESSION_SECRET, DOMAIN and PUBLIC_ORIGIN.
# Use a cryptographically random secret, e.g. openssl rand -hex 32
docker compose -f docker-compose.yml -f compose.proxy.yml up -d --build
docker compose -f docker-compose.yml -f compose.proxy.yml logs -f app
```

Visit your **HTTPS** domain. The first registered user becomes the owner of a new workspace even when ALLOW_SIGNUP=false. Later users need an invitation. The app listens on `127.0.0.1:8080` on the host; Caddy handles public HTTPS on ports 80/443. Do not expose plain HTTP 8080 to the internet. Set `PUBLIC_ORIGIN=https://your-domain` without a trailing slash and match `DOMAIN=your-domain`.

**Without a public domain:** deploy behind your existing HTTPS reverse proxy instead and omit `compose.proxy.yml`. Ensure its forwarded TLS URL exactly matches `PUBLIC_ORIGIN`. Never publish the database service.

## Development

Requires Node 22+ and PostgreSQL 16+. Use a local PostgreSQL database and export DATABASE_URL, SESSION_SECRET (32+ chars), PUBLIC_ORIGIN=http://localhost:8080, NODE_ENV=development.

```bash
npm install
npm --prefix web install
npm run dev:api
# in a second terminal
npm run dev:web
```

Open http://localhost:5173. Vite proxies `/api` to the local Fastify server.

## App-to-app integrations

Open Settings > Connect an application. Give each integrating server a separate read-only or read/write key. Copy its secret immediately: **it is displayed only once**. Send `Authorization: Bearer nd_...` from backend applications, never public JavaScript or mobile binaries.

```bash
curl -H "Authorization: Bearer nd_YOUR_KEY" \
 "https://drive.example.org/api/workspaces/WORKSPACE_UUID/nodes"
curl -X POST -H "Authorization: Bearer nd_WRITE_KEY" \
 -F "file=@report.pdf" \
 "https://drive.example.org/api/workspaces/WORKSPACE_UUID/upload"
```

See [API reference](docs/API.md), [operations & backup guide](docs/OPERATIONS.md), and [roadmap](docs/ROADMAP.md).

## Operational security / backups

- Keep both `postgres_data` and `nexdrive_data` volumes; database-only backups cannot restore files.
- Schedule encrypted offsite backups of PostgreSQL and the file volume; regularly test recovery.
- Keep ALLOW_SIGNUP=false and use long random secrets; protect the .env file from other system users.
- Apply security patches, monitor free disk space, and limit reverse-proxy upload sizes.
- GitHub Actions CI compiles the app and performs an HTTP smoke test using PostgreSQL; verify the first CI run succeeds before trusting production deployment.
- The initial release uses local disk. **Run one app instance only**; use an object-storage adapter before scaling to multiple nodes.
- API keys are powerful credentials; scope them to the intended workspace and revoke promptly when lost.

This is an initial foundation, **not yet a complete Google Drive clone**. Chunked/resumable transfers, malware scanning, content search, granular per-file ACLs, comprehensive auditing, SSO and desktop synchronization are planned but not included. Avoid storing highly sensitive regulated files until threat modeling, review and restore testing are complete.
