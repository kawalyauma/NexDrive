# NexDrive development roadmap

## First foundation
- [x] PostgreSQL metadata + local blob disk store
- [x] Workspace membership, invites and role-based API authorization
- [x] UI for uploads, folders, search, trash, restore, sharing and management
- [x] Workspace-scoped hashed read/write API keys
- [x] Docker Compose and HTTPS reverse proxy example
- [x] TypeScript build workflow and API smoke test (execution currently blocked by GitHub runner provisioning)

- [x] Starred/recent items, file copy, basic image/PDF previews and revision history
- [x] Revocable sessions, account password change and basic activity log
- [x] Workspace membership role and removal controls

## Planned next
- [ ] Database migrations with versioned, rollback-aware releases
- [ ] Paginated lists, sorting, nested folder tree and bulk operations
- [ ] Drag-and-drop uploads and resumable chunked transfers
- [ ] Rich previews, thumbnail generation and media streaming
- [x] File revision download and restoration
- [ ] User/group/folder-level sharing permissions
- [ ] Malware scanning, quarantine and audit events
- [ ] Object storage adapter and multi-instance horizontal scale
- [ ] Full-text search and asynchronous metadata extraction
- [ ] SSO / OIDC, MFA and user recovery
- [ ] Background jobs, retention and backup restore automation
- [ ] Desktop sync, WebDAV and mobile applications
- [ ] Online document editing and collaboration

The foundation is not intended to be marketed as feature-complete or formally security-audited.
