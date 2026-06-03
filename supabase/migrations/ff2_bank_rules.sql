-- ff2_bank_rules — FF-2 Phase B: founder-editable bank categorization rules.
-- Same operational shape as omni_operational_data_layer.sql:
--   { id uuid pk, org_id text, source_doc_id text UNIQUE, data jsonb, created_at }
--   data = full camelCase rule doc → client reads { _docId, ...data }
--   RLS `tenant_isolation`: org_id = auth.jwt()->>'orgId'
--   Realtime: in supabase_realtime publication + REPLICA IDENTITY FULL
-- Idempotent: safe to re-run.

create table if not exists public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.bank_rules enable row level security;
drop policy if exists tenant_isolation on public.bank_rules;
create policy tenant_isolation on public.bank_rules for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));

create index if not exists idx_bank_rules_org on public.bank_rules (org_id);
alter table public.bank_rules replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.bank_rules';
  exception when duplicate_object then null;
  end;
end $$;
