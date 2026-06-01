-- omni_operational_data_layer
-- ADR-0015: move the 14 operational collections off Firestore onto Supabase.
-- Mirrors the proven time-series shape (omni_timeseries_data_layer):
--   { id uuid pk, org_id text, source_doc_id text UNIQUE, <typed cols>, data jsonb, created_at }
--   source_doc_id = Firestore doc id (idempotency key, ON CONFLICT)
--   data          = the COMPLETE original camelCase doc → client reads { _docId, ...data }
--   RLS policy `tenant_isolation`: org_id = auth.jwt()->>'orgId' (the Firebase claim)
--   Realtime: every table is in the supabase_realtime publication + REPLICA IDENTITY FULL
--             (RLS re-checks org_id on UPDATE/DELETE → the old row must carry org_id).
-- Typed columns are ONLY the fields used in a server-side where/orderBy (verified by
-- grepping every useOrgCollection({where,orderBy}) call); everything else lives in `data`.
-- Idempotent: safe to re-run (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).

-- ───────────────────────── trigger helpers ─────────────────────────
-- Re-derive indexed typed columns from `data` on every write, so RPC/patch writes
-- (which touch only `data`) keep the typed cols (and thus indexes/ordering) consistent.
-- Defensive casts: a malformed timestamp falls back to NULL instead of failing the write.

create or replace function omni_sync_created_at_ts() returns trigger
language plpgsql as $$
begin
  begin new.created_at_ts := (new.data->>'createdAt')::timestamptz;
  exception when others then new.created_at_ts := null; end;
  return new;
end $$;

create or replace function omni_sync_repair_sessions() returns trigger
language plpgsql as $$
begin
  new.scooter_id := new.data->>'scooterId';
  begin new.completed_at := (new.data->>'completedAt')::timestamptz;
  exception when others then new.completed_at := null; end;
  return new;
end $$;

-- ───────────────────────── table factory (manual, explicit per table) ─────────────────────────
-- Each block: table → RLS → policy → indexes → realtime → (trigger).

-- 1. pow_tasks ─ client-sorted, org-scoped only
create table if not exists public.pow_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.pow_tasks enable row level security;
drop policy if exists tenant_isolation on public.pow_tasks;
create policy tenant_isolation on public.pow_tasks for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_pow_tasks_org on public.pow_tasks (org_id);
alter table public.pow_tasks replica identity full;

-- 2. maintenance_tickets ─ client-sorted, org-scoped only
create table if not exists public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.maintenance_tickets enable row level security;
drop policy if exists tenant_isolation on public.maintenance_tickets;
create policy tenant_isolation on public.maintenance_tickets for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_maintenance_tickets_org on public.maintenance_tickets (org_id);
alter table public.maintenance_tickets replica identity full;

-- 3. maintenance_parts ─ org-scoped only (stock read/decremented inside the RPC via data jsonb)
create table if not exists public.maintenance_parts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.maintenance_parts enable row level security;
drop policy if exists tenant_isolation on public.maintenance_parts;
create policy tenant_isolation on public.maintenance_parts for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_maintenance_parts_org on public.maintenance_parts (org_id);
alter table public.maintenance_parts replica identity full;

-- 4. scooters ─ org-scoped only
create table if not exists public.scooters (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.scooters enable row level security;
drop policy if exists tenant_isolation on public.scooters;
create policy tenant_isolation on public.scooters for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_scooters_org on public.scooters (org_id);
alter table public.scooters replica identity full;

-- 5. repair_sessions ─ orderBy completedAt desc; where scooterId (ServiceHistory F4)
create table if not exists public.repair_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  scooter_id text,
  completed_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.repair_sessions enable row level security;
drop policy if exists tenant_isolation on public.repair_sessions;
create policy tenant_isolation on public.repair_sessions for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_repair_sessions_org_completed on public.repair_sessions (org_id, completed_at desc);
create index if not exists idx_repair_sessions_org_scooter on public.repair_sessions (org_id, scooter_id);
alter table public.repair_sessions replica identity full;
drop trigger if exists trg_repair_sessions_sync on public.repair_sessions;
create trigger trg_repair_sessions_sync before insert or update on public.repair_sessions
  for each row execute function omni_sync_repair_sessions();

-- 6. repair_procedures ─ orderBy createdAt desc
create table if not exists public.repair_procedures (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  created_at_ts timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.repair_procedures enable row level security;
drop policy if exists tenant_isolation on public.repair_procedures;
create policy tenant_isolation on public.repair_procedures for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_repair_procedures_org_created on public.repair_procedures (org_id, created_at_ts desc);
alter table public.repair_procedures replica identity full;
drop trigger if exists trg_repair_procedures_sync on public.repair_procedures;
create trigger trg_repair_procedures_sync before insert or update on public.repair_procedures
  for each row execute function omni_sync_created_at_ts();

-- 7. projects ─ client-sorted; `version` backs the optimistic-CAS RMW (rmw_commit)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  version int not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
drop policy if exists tenant_isolation on public.projects;
create policy tenant_isolation on public.projects for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_projects_org on public.projects (org_id);
alter table public.projects replica identity full;

-- 8. decision_gates ─ org-scoped only
create table if not exists public.decision_gates (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.decision_gates enable row level security;
drop policy if exists tenant_isolation on public.decision_gates;
create policy tenant_isolation on public.decision_gates for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_decision_gates_org on public.decision_gates (org_id);
alter table public.decision_gates replica identity full;

-- 9. brainstorm_ideas ─ client-sorted, org-scoped only
create table if not exists public.brainstorm_ideas (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.brainstorm_ideas enable row level security;
drop policy if exists tenant_isolation on public.brainstorm_ideas;
create policy tenant_isolation on public.brainstorm_ideas for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_brainstorm_ideas_org on public.brainstorm_ideas (org_id);
alter table public.brainstorm_ideas replica identity full;

-- 10. issues ─ orderBy createdAt desc
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  created_at_ts timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.issues enable row level security;
drop policy if exists tenant_isolation on public.issues;
create policy tenant_isolation on public.issues for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_issues_org_created on public.issues (org_id, created_at_ts desc);
alter table public.issues replica identity full;
drop trigger if exists trg_issues_sync on public.issues;
create trigger trg_issues_sync before insert or update on public.issues
  for each row execute function omni_sync_created_at_ts();

-- 11. notifications ─ orderBy createdAt desc
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  created_at_ts timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
drop policy if exists tenant_isolation on public.notifications;
create policy tenant_isolation on public.notifications for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_notifications_org_created on public.notifications (org_id, created_at_ts desc);
alter table public.notifications replica identity full;
drop trigger if exists trg_notifications_sync on public.notifications;
create trigger trg_notifications_sync before insert or update on public.notifications
  for each row execute function omni_sync_created_at_ts();

-- 12. diary ─ orderBy createdAt desc
create table if not exists public.diary (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  created_at_ts timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.diary enable row level security;
drop policy if exists tenant_isolation on public.diary;
create policy tenant_isolation on public.diary for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_diary_org_created on public.diary (org_id, created_at_ts desc);
alter table public.diary replica identity full;
drop trigger if exists trg_diary_sync on public.diary;
create trigger trg_diary_sync before insert or update on public.diary
  for each row execute function omni_sync_created_at_ts();

-- 13. costs ─ no server orderBy (#365), org-scoped only
create table if not exists public.costs (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.costs enable row level security;
drop policy if exists tenant_isolation on public.costs;
create policy tenant_isolation on public.costs for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_costs_org on public.costs (org_id);
alter table public.costs replica identity full;

-- 14. app_config ─ folds the `config/${org}_*` + `pow/${org}_config` singletons.
--     Read/written by source_doc_id (the existing composite doc id); globally unique.
create table if not exists public.app_config (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists tenant_isolation on public.app_config;
create policy tenant_isolation on public.app_config for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));
create index if not exists idx_app_config_org on public.app_config (org_id);
alter table public.app_config replica identity full;

-- ───────────────────────── realtime publication (idempotent) ─────────────────────────
-- Add each table to supabase_realtime; ignore if already a member.
do $$
declare t text;
begin
  foreach t in array array[
    'pow_tasks','maintenance_tickets','maintenance_parts','scooters','repair_sessions',
    'repair_procedures','projects','decision_gates','brainstorm_ideas','issues',
    'notifications','diary','costs','app_config'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
