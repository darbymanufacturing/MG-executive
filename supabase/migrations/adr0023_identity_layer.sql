-- adr0023_identity_layer
-- ADR-0023 Stage 1: move the three identity collections off Firestore onto Supabase.
--
-- Tables
--   public.users         — one row per Firebase user.
--                          source_doc_id = Firebase uid (auth.jwt()->>'sub').
--                          org_id        = the user's orgId claim.
--
--   public.organizations — one row per tenant org.
--                          source_doc_id = orgId (same as org_id — a member whose claim
--                          orgId=X reads exactly org X via the org_id column).
--                          org_id        = the org's own id.
--
--   public.invites       — one row per pending invite token.
--                          source_doc_id = the invite token string.
--                          org_id        = the inviting org's id.
--
-- Row shape (same as omni_operational_data_layer):
--   { id uuid pk, org_id text, source_doc_id text UNIQUE, data jsonb, created_at timestamptz }
--   data = the COMPLETE original Firestore doc (camelCase).
--   Client reads { _docId: source_doc_id, ...data }.
--
-- Claim mapping (Firebase ID token verified by Supabase JWT secret):
--   auth.jwt()->>'sub'       = Firebase uid (used as source_doc_id for users rows)
--   auth.jwt()->>'orgId'     = org claim   (used as org_id for all three tables)
--   auth.jwt()->>'user_role' = app RBAC role: owner | admin | staff | crew | …
--   NOTE: 'user_role' NOT 'role' — Supabase reserves role='authenticated' (ADR-0017/#569).
--
-- RLS predicates are a faithful translation of firestore.rules lines 259-296.
-- Per-command policies are used throughout because SELECT/INSERT/UPDATE/DELETE
-- have distinct predicates on identity rows (unlike the uniform org_id guard on
-- operational tables which uses a single FOR ALL policy).
--
-- Server-side identity operations (sync-claim, create-invite, accept-invite, etc.)
-- use the service-role client in api/_lib/supabase-admin.js, which bypasses RLS.
-- Client writes are intentionally restricted.
--
-- No RPCs in this file.  A redeem_invite RPC (if needed) is a separate migration.
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS /
-- CREATE INDEX IF NOT EXISTS / exception when duplicate_object).

-- ═══════════════════════════════════════════════════════════════════
-- 1. public.users
--    Firestore: /users/{uid}
--    source_doc_id = Firebase uid  |  org_id = user's orgId
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.users (
  id             uuid        primary key default gen_random_uuid(),
  org_id         text        not null,
  source_doc_id  text        not null unique,
  data           jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.users enable row level security;

-- SELECT: self OR same-org owner/admin
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to public
  using (
    (source_doc_id = (auth.jwt() ->> 'sub'))
    or
    (
      (auth.jwt() ->> 'user_role') in ('owner', 'admin')
      and org_id = (auth.jwt() ->> 'orgId')
    )
  );

-- INSERT: self-create bootstrap only (server uses service-role; this covers client self-create)
drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to public
  with check (source_doc_id = (auth.jwt() ->> 'sub'));

-- UPDATE: self OR same-org owner/admin (mirrors SELECT predicate)
drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to public
  using (
    (source_doc_id = (auth.jwt() ->> 'sub'))
    or
    (
      (auth.jwt() ->> 'user_role') in ('owner', 'admin')
      and org_id = (auth.jwt() ->> 'orgId')
    )
  )
  with check (
    (source_doc_id = (auth.jwt() ->> 'sub'))
    or
    (
      (auth.jwt() ->> 'user_role') in ('owner', 'admin')
      and org_id = (auth.jwt() ->> 'orgId')
    )
  );

-- DELETE: org owner/admin only
drop policy if exists users_delete on public.users;
create policy users_delete on public.users
  for delete to public
  using (
    (auth.jwt() ->> 'user_role') in ('owner', 'admin')
    and org_id = (auth.jwt() ->> 'orgId')
  );

create index if not exists idx_users_org on public.users (org_id);
alter table public.users replica identity full;


-- ═══════════════════════════════════════════════════════════════════
-- 2. public.organizations
--    Firestore: /organizations/{orgId}
--    source_doc_id = orgId  |  org_id = the org's OWN id
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.organizations (
  id             uuid        primary key default gen_random_uuid(),
  org_id         text        not null,
  source_doc_id  text        not null unique,
  data           jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- SELECT: members read their own org (org_id = the org's own id, so claim orgId=X reads row X)
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to public
  using (org_id = (auth.jwt() ->> 'orgId'));

-- INSERT: signed-in user who names themselves ownerUid (bootstrap signup — no claims yet)
drop policy if exists organizations_insert on public.organizations;
create policy organizations_insert on public.organizations
  for insert to public
  with check ((data ->> 'ownerUid') = (auth.jwt() ->> 'sub'));

-- UPDATE: members of the org who hold owner or admin role
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to public
  using (
    org_id = (auth.jwt() ->> 'orgId')
    and (auth.jwt() ->> 'user_role') in ('owner', 'admin')
  )
  with check (
    org_id = (auth.jwt() ->> 'orgId')
    and (auth.jwt() ->> 'user_role') in ('owner', 'admin')
  );

-- DELETE: org owner only
drop policy if exists organizations_delete on public.organizations;
create policy organizations_delete on public.organizations
  for delete to public
  using (
    org_id = (auth.jwt() ->> 'orgId')
    and (auth.jwt() ->> 'user_role') = 'owner'
  );

create index if not exists idx_organizations_org on public.organizations (org_id);
alter table public.organizations replica identity full;


-- ═══════════════════════════════════════════════════════════════════
-- 3. public.invites
--    Firestore: /invites/{token}
--    source_doc_id = invite token  |  org_id = inviting org's id
--    Client writes are default-deny; server uses service-role for
--    create/peek/redeem (api/create-invite, api/accept-invite).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.invites (
  id             uuid        primary key default gen_random_uuid(),
  org_id         text        not null,
  source_doc_id  text        not null unique,
  data           jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.invites enable row level security;

-- SELECT: org owner/admin may read their own org's invite roster
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
  for select to public
  using (
    (auth.jwt() ->> 'user_role') in ('owner', 'admin')
    and org_id = (auth.jwt() ->> 'orgId')
  );

-- No INSERT / UPDATE / DELETE policies → client writes are default-deny.
-- All mutations go through api/_lib/supabase-admin.js (service-role, bypasses RLS).

create index if not exists idx_invites_org on public.invites (org_id);
alter table public.invites replica identity full;


-- ═══════════════════════════════════════════════════════════════════
-- Realtime publication (idempotent — ignore if table already a member)
-- ═══════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['users', 'organizations', 'invites'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
