-- MEGALUME Motion Hub — esquema inicial (Especificação §6)
CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor','motion_designer','curator','admin','support')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  team_id uuid REFERENCES teams(id),
  slug text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  summary text,
  tags text[] NOT NULL DEFAULT '{}',
  synonyms text[] NOT NULL DEFAULT '{}',
  category text,
  client text,
  aspect_ratio text NOT NULL DEFAULT 'any',
  language text,
  hosts text[] NOT NULL DEFAULT '{}',
  rights text NOT NULL,
  creator_id uuid NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','review','published','deprecated')),
  current_version_id uuid,
  search_text text NOT NULL DEFAULT '',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
CREATE INDEX assets_org_state_idx ON assets (org_id, state) WHERE deleted_at IS NULL;
CREATE INDEX assets_updated_idx ON assets (org_id, updated_at);

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES assets(id),
  semver text NOT NULL,
  host_targets jsonb NOT NULL,
  manifest jsonb NOT NULL,
  manifest_schema text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','published','withdrawn')),
  changelog text,
  release_date timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, semver)
);
ALTER TABLE assets ADD CONSTRAINT assets_current_version_fk FOREIGN KEY (current_version_id) REFERENCES asset_versions(id);

CREATE TABLE asset_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES asset_versions(id) ON DELETE CASCADE,
  role text NOT NULL,
  path text NOT NULL,
  mime text NOT NULL,
  bytes bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, path)
);

CREATE TABLE packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  slug text NOT NULL,
  name text NOT NULL,
  version text NOT NULL,
  requirements jsonb NOT NULL DEFAULT '{}',
  dependencies jsonb NOT NULL DEFAULT '[]',
  license text NOT NULL,
  signed_manifest jsonb,
  signature text,
  archive_key text,
  archive_sha256 text,
  archive_bytes bigint,
  status text NOT NULL DEFAULT 'building' CHECK (status IN ('building','ready','failed','revoked')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug, version)
);

CREATE TABLE pack_items (
  pack_id uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES asset_versions(id),
  PRIMARY KEY (pack_id, version_id)
);

CREATE TABLE collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  team_id uuid REFERENCES teams(id),
  name text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','org')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_items (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, asset_id)
);

CREATE TABLE favourites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  user_id uuid REFERENCES users(id),
  name text NOT NULL,
  os text NOT NULL,
  app_version text,
  host_versions jsonb NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installs (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  pack_slug text NOT NULL,
  installed_version text NOT NULL,
  status text NOT NULL,
  last_check timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, pack_slug)
);

-- Sem conteúdo de projeto: apenas quem, qual asset/versão, host e ação.
CREATE TABLE usage_events (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id),
  actor_id uuid REFERENCES users(id),
  asset_version_id uuid REFERENCES asset_versions(id),
  host text,
  action text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  input jsonb NOT NULL,
  progress real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  retries int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  output jsonb,
  error_code text,
  error_detail text,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_queue_idx ON jobs (status, run_after);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  data jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_at_idx ON audit_log (org_id, at DESC);

CREATE TABLE diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  user_id uuid REFERENCES users(id),
  device_id uuid REFERENCES devices(id),
  payload jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
