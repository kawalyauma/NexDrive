CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
 id uuid PRIMARY KEY, name text NOT NULL,
 owner_id uuid NOT NULL REFERENCES users(id),
 quota_bytes bigint NOT NULL CHECK(quota_bytes >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','admin','member')),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS nodes (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 parent_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('folder','file')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 255),
 blob_key text, size_bytes bigint NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
 mime_type text, sha256 text, deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='folder' AND blob_key IS NULL) OR (kind='file' AND blob_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS nodes_parent_idx ON nodes(workspace_id,parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS nodes_search_idx ON nodes(workspace_id,lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_root_unique ON nodes(workspace_id,name)
 WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_child_unique ON nodes(workspace_id,parent_id,name)
 WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_blob_unique ON nodes(blob_key) WHERE blob_key IS NOT NULL;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sha256 text;
CREATE INDEX IF NOT EXISTS nodes_sha256_idx ON nodes(workspace_id,sha256) WHERE sha256 IS NOT NULL;
CREATE TABLE IF NOT EXISTS api_keys (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, key_hash text NOT NULL UNIQUE,
 permission text NOT NULL CHECK(permission IN ('read','write')),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')),
 token_hash text NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL, accepted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS shares (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 node_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_jobs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 group_ref text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','paused','done','failed')),
 discovered integer NOT NULL DEFAULT 0, downloaded integer NOT NULL DEFAULT 0,
 posted integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0,
 bytes_downloaded bigint NOT NULL DEFAULT 0, current_file text, current_bytes bigint NOT NULL DEFAULT 0,
 current_total bigint NOT NULL DEFAULT 0, error text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS telegram_jobs_workspace_idx ON telegram_jobs(workspace_id,created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_items (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES telegram_jobs(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 group_ref text NOT NULL, message_id bigint NOT NULL, node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
 file_name text NOT NULL, size_bytes bigint NOT NULL DEFAULT 0, sha256 text,
 status text NOT NULL CHECK(status IN ('downloading','stored','posted','skipped','failed')),
 edushare_resource_id text, edushare_slug text, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,group_ref,message_id)
);

CREATE TABLE IF NOT EXISTS fresh_teacher_sources (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 repo text NOT NULL,
 branch text NOT NULL DEFAULT 'main',
 license text NOT NULL,
 last_commit text,
 status text NOT NULL DEFAULT 'queued',
 scanned bigint NOT NULL DEFAULT 0,
 downloaded bigint NOT NULL DEFAULT 0,
 posted bigint NOT NULL DEFAULT 0,
 skipped bigint NOT NULL DEFAULT 0,
 failed bigint NOT NULL DEFAULT 0,
 bytes_downloaded bigint NOT NULL DEFAULT 0,
 current_file text,
 error text,
 started_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,repo)
);

CREATE TABLE IF NOT EXISTS fresh_teacher_items (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 repo text NOT NULL,
 path text NOT NULL,
 blob_sha text NOT NULL,
 commit_sha text NOT NULL,
 license text NOT NULL,
 node_id uuid REFERENCES nodes(id) ON DELETE SET NULL,
 file_name text NOT NULL,
 size_bytes bigint NOT NULL DEFAULT 0,
 sha256 text,
 status text NOT NULL DEFAULT 'queued',
 edushare_resource_id text,
 edushare_slug text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,repo,path,blob_sha)
);
CREATE INDEX IF NOT EXISTS fresh_teacher_items_recent_idx ON fresh_teacher_items(workspace_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS fresh_teacher_settings (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 mode text NOT NULL DEFAULT 'licensed_downloads'
  CHECK(mode IN ('licensed_downloads','all_index')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_items_job_idx ON telegram_items(job_id,created_at DESC);

-- The always-on Telegram importer (telegram-service container). The web app toggles `enabled` and shows the state.
CREATE TABLE IF NOT EXISTS telegram_service (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true, run_now boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'starting', message text, current_job uuid,
 heartbeat_at timestamptz, last_pass_at timestamptz, next_pass_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE telegram_jobs ADD COLUMN IF NOT EXISTS group_title text;
