-- ff2_loans — FF-2 Phase C: multi-loan tracking (org-scoped, company-wide).
-- Same operational shape as omni_operational_data_layer.sql:
--   { id uuid pk, org_id text, source_doc_id text UNIQUE, data jsonb, created_at }
--   data = full loan doc { loanNumber, name, currentBalance, entries[], ... }
--   RLS `tenant_isolation`: org_id = auth.jwt()->>'orgId'
--   Realtime: in supabase_realtime publication + REPLICA IDENTITY FULL
-- Idempotent: safe to re-run.

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.loans enable row level security;
drop policy if exists tenant_isolation on public.loans;
create policy tenant_isolation on public.loans for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));

create index if not exists idx_loans_org on public.loans (org_id);
alter table public.loans replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.loans';
  exception when duplicate_object then null;
  end;
end $$;