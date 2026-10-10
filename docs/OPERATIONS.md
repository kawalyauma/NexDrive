# Operating NexDrive on a self-hosted server

This release uses **one application container**, PostgreSQL, and a named Docker storage volume. There is no data replication, antivirus scanner, background repair queue or multi-node deployment capability yet.

## Initial provisioning

1. Install Docker Engine and its Compose plugin, configure DNS to point to your server, and open TCP 80/443.
2. Copy `.env.example` to `.env`. Generate **three different**, long random secrets for `POSTGRES_PASSWORD`, `SESSION_SECRET` and `BOOTSTRAP_TOKEN` (e.g. `openssl rand -hex 32` for each). Never commit this file.
3. Set `DOMAIN=drive.example.org` and `PUBLIC_ORIGIN=https://drive.example.org`, without a trailing slash.
4. Run `docker compose -f docker-compose.yml -f compose.proxy.yml up -d --build`.
5. Register the first user with the setup token from `.env`. That user becomes the owner. Further registration is invitation-only with `ALLOW_SIGNUP=false`.
6. After setup, rotate the bootstrap token to an unrelated random value. Keep `ALLOW_SIGNUP=false`.

## Diagnostics

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 db
curl -fsS https://drive.example.org/api/health
docker compose exec db pg_isready
```

Application host port 8080 is bound to localhost; Caddy (optional overlay file) serves external HTTPS. Never publish PostgreSQL directly. The health endpoint indicates that the HTTP app is available; it does not perform a database or file integrity check.

## Backup and restore policy

Back up **both** the PostgreSQL contents (accounts, permissions, metadata) and the `nexdrive_data` Docker volume (actual file bytes). One without the other is not a usable recovery point. Store copies off-server, encrypted, test restores regularly and set up disk-space alerts.

For a *consistent offline backup* in a maintenance window:

1. Stop application writes with `docker compose stop app`.
2. With PostgreSQL still running, make a database dump:

   ```bash
   mkdir -p backups
   docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/nexdrive-db.dump
   ```

3. Export the Docker volume using its actual name from `docker volume ls`, e.g. `<compose-project>_nexdrive_data`:

   ```bash
   docker run --rm -v ACTUAL_NEXDRIVE_VOLUME_NAME:/data:ro \
     -v "$PWD/backups:/backup" alpine sh -c 'cd /data && tar -czf /backup/nexdrive-files.tar.gz .'
   ```

4. Encrypt the dump and file archive, copy them to separate storage, validate their sizes/checksums, and restart the app with `docker compose start app`.

For recovery, provision fresh volumes, restore the PostgreSQL dump with `pg_restore` into an empty database, extract the file archive to the NexDrive storage volume with correct permissions, then start the app. Perform a full recovery drill on a throwaway server before relying on this procedure for live data.

**Do not assume a hot tar backup is transactionally consistent.** A snapshot-capable filesystem with coordinated database checkpointing is preferable once the platform handles important documents.

## Updating

```bash
git pull --ff-only
docker compose -f docker-compose.yml -f compose.proxy.yml up -d --build
```

Back up before updating. Schema initialization is currently idempotent, but not a replacement for versioned migrations. Avoid unreviewed breaking database changes.

## Monitoring and safety

- Check volume growth and host free space; workspace quotas do not protect against unlimited workspace creation.
- Watch authentication failures, failed uploads, HTTP 5xx responses, disk errors, and database backups.
- Patch OS, Docker and image dependencies.
- Never expose application API keys to browser JavaScript or include them in mobile applications.
- Downloads are attachments, not previews. Untrusted uploads have **not** been malware-scanned.
- Enable stronger identity controls and an antivirus gateway before serving untrusted users at scale.
