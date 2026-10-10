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
 mime_type text, deleted_at timestamptz,
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
