# NexDrive HTTP API (v0.1)

Base path: `/api`. JSON unless indicated. User browser requests use an HttpOnly session cookie and an `Origin` matching PUBLIC_ORIGIN. Trusted server integrations use `Authorization: Bearer nd_<secret>`. No browser CORS support is enabled for API keys.

## Accounts

| Method | Path | Payload / behavior |
|---|---|---|
| POST | `/auth/register` | `{name,email,password,workspaceName?,inviteToken?}` (password minimum 12 chars) |
| POST | `/auth/login` | `{email,password}` |
| POST | `/auth/logout` | Clear cookie |
| GET | `/auth/me` | Profile and accessible workspaces |
| POST | `/workspaces` | `{name}` create another workspace |
| POST | `/invitations/accept` | `{token}` join as signed-in user |

Invited new users register with the invitation token. Existing signed-in users accept via `/invitations/accept`.

## Files and folders

Replace `:wid` with the workspace UUID and `:id` with the node UUID.

| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:wid/nodes` | Root list; optional `?parentId=UUID`, `?q=term`, or `?trash=true` |
| POST | `/workspaces/:wid/folders` | `{name,parentId?:UUID|null}` |
| POST | `/workspaces/:wid/upload?parentId=UUID` | `multipart/form-data`, field `file`; parentId optional |
| GET | `/workspaces/:wid/nodes/:id/download` | Attachment download |
| PATCH | `/workspaces/:wid/nodes/:id` | `{name?,parentId?:UUID|null}` for rename/move |
| POST | `/workspaces/:wid/nodes/:id/trash` | Move item/subtree to trash |
| POST | `/workspaces/:wid/nodes/:id/restore` | Restore deleted item/subtree |
| DELETE | `/workspaces/:wid/nodes/:id` | Permanently delete a trashed item/subtree |
| GET | `/workspaces/:wid/usage` | Usage and quota (including archived versions and trash) |
| GET | `/workspaces/:wid/recent` | Recently modified files/folders |
| GET | `/workspaces/:wid/starred` | Signed-in user's starred items |
| POST / DELETE | `/workspaces/:wid/nodes/:id/star` | Star or unstar for signed-in user |
| POST | `/workspaces/:wid/nodes/:id/copy` | `{name?}` duplicate a file |
| GET | `/workspaces/:wid/nodes/:id/preview` | Inline sandboxed image or PDF preview |
| GET | `/workspaces/:wid/nodes/:id/versions` | List current and archived revisions |
| POST | `/workspaces/:wid/nodes/:id/versions` | Multipart file replacement, retaining old revision |
| GET | `/workspaces/:wid/nodes/:id/versions/:version/download` | Download a revision |
| POST | `/workspaces/:wid/nodes/:id/versions/:version/restore` | Restore archived revision as new current version |
| POST | `/workspaces/:wid/nodes/:id/shares` | `{days:1..30}`, read-only link (file only) |
| GET | `/shares/:token` | Anonymous expiring attachment download |
| GET | `/workspaces/:wid/nodes/:id/shares` | List active shares (no token disclosed) |
| DELETE | `/workspaces/:wid/nodes/:id/shares` | Revoke all active shares for a node |

Lists are limited to 200 results in this foundation; pagination will follow. Storage quotas count all non-purged blobs, **including trash**.

## Workspace administration (owner or admin only)

| Method | Path | Notes |
|---|---|---|
| GET | `/workspaces/:wid/members` | Member list |
| PATCH | `/workspaces/:wid/members/:id` | Owner-only role change (`{role:'admin'|'member'}`) |
| DELETE | `/workspaces/:wid/members/:id` | Remove a member (owner protected) |
| GET | `/workspaces/:wid/activity` | Admin workspace activity log |
| POST | `/workspaces/:wid/invitations` | `{email,role:'admin'|'member'}`; response gives invite URL (no email is sent automatically) |
| GET | `/workspaces/:wid/api-keys` | List keys (secrets never returned) |
| POST | `/workspaces/:wid/api-keys` | `{name,permission:'read'|'write'}`; response includes secret **once** |
| DELETE | `/workspaces/:wid/api-keys/:id` | Revoke key |

Read-only app keys can list/download/search. Write keys can additionally mutate and share files, but cannot administer membership or mint new API keys. All key requests are restricted to the one workspace attached to the key.

## Errors and safety

Errors return `{error:string}` with appropriate HTTP codes (400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 413 too large, 429 rate limit). Original filenames do **not** become server filesystem paths. Downloads use `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.

**Integration guidance:** Treat service API keys like passwords. Use them from trusted backends only; never embed them in frontend bundles. Use HTTPS and restrict who can provision keys.
