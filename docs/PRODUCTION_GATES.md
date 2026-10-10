# Production readiness review

NexDrive is a useful foundation, **not yet approved for production workloads containing important or highly sensitive files**.

## Already implemented

- Self-hosted Docker Compose + optional Caddy HTTPS entrypoint
- PostgreSQL metadata and private local-disk blob storage
- Registration bootstrap secret and invitation-only accounts
- Workspace membership and owner/admin/member roles
- Argon2id password hashing, revocable cookie sessions, login throttling, logout-all
- App API keys with hash-at-rest and read/write scope by workspace
- File operations, basic previews, revision history and user favorites
- Time-limited public file links and revocation
- Basic audit events, quotas, health endpoint and integration smoke script

## Required before serious public use

1. **Restore CI execution.** GitHub Actions has been failing before starting job steps. See issue #1. Build success and smoke tests are not verified.
2. **Perform real Docker tests.** Confirm initial registration, invite acceptance, upload, download, revision recovery, trash, permissions, and both desktop/mobile interfaces.
3. **Review security.** Threat-model uploads and sharing, configure malware scanning/quarantine, review session and key management, exercise permissions across workspaces, verify HTTP security headers.
4. **Protect storage.** Encrypted offsite backups, alerting, recovery drills, disk space policies, orphan blob cleanup and transactional consistency strategy.
5. **Operational scale.** User onboarding/email, long-running upload support, pagination, background queue, job retries, resource budgets, and schema migration versioning.
6. **Feature parity.** Fine-grained user/group file sharing, folder sharing, previews for Office formats, folder downloads, version retention, sync and file-level ACLs are still pending.

**Security boundary:** Workspace collaborators can currently access every file in that workspace. Each app key can access the entire workspace too. Separate apps or tenants that need isolation must be assigned separate workspaces. Do not treat current access rules as file-level permissions.

## How to validate on a trusted staging server

```bash
cp .env.example .env
# Generate random secrets and set your DNS/domain variables.
bash scripts/preflight.sh
docker compose -f docker-compose.yml -f compose.proxy.yml up --build -d
docker compose -f docker-compose.yml -f compose.proxy.yml ps
curl -fsS https://YOUR_DOMAIN/api/health
```

The `tests/smoke.sh` integration test **creates users and modifies files**, and assumes a clean local HTTP instance with test secrets. **Run it only against a disposable PostgreSQL instance, never against production data.**

A green build and test report must be observed before advertising the system as production-ready.
