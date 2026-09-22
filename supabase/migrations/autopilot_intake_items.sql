-- autopilot_intake_items — Omni Autopilot Phase 1 (docs/AUTOMATION_PLAN.md §3.2).
--
-- One queue every automatic source writes into: the Wallet bank feed, AADE
-- myDATA invoices, the Gmail invoice watcher, WhatsApp captures, Hopp CSV drops
-- and internal rules. Items arrive as DRAFTS with their evidence attached; the
-- matcher merges duplicates; the confidence gate either commits them or holds
-- them for the owner (who chose "hold until approved" on 2026-09-22).
--
-- Same operational shape as every other table (omni_operational_data_layer.sql):
--   { id uuid pk, org_id text, source_doc_id text UNIQUE, data jsonb, created_at }
--   data = the full intake item:
--     { source, sourceRef, kind, payload, evidence, confidence, reasons[],
--       match, status, committedRef, decidedAt, decidedBy, createdAt, updatedAt }
--   RLS `tenant_isolation`: org_id = auth.jwt()->>'orgId'
--   Realtime: in supabase_realtime publication + REPLICA IDENTITY FULL
--
-- IDEMPOTENCY: source_doc_id is built as `${orgId}_intake_${source}_${sourceRef}`
-- (orgDocId convention), where sourceRef is the source's own stable id — a Wallet
-- record id, a myDATA MARK, a Gmail message+attachment id, a WhatsApp message id.
-- Re-running any sync therefore upserts the same row instead of duplicating it,
-- exactly like the FF-2 bank importer's `_bankTxId`.
--
-- Idempotent: safe to re-run.

create table if not exists public.intake_items (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  source_doc_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.intake_items enable row level security;
drop policy if exists tenant_isolation on public.intake_items;
create policy tenant_isolation on public.intake_items for all to public
  using (org_id = (auth.jwt() ->> 'orgId')) with check (org_id = (auth.jwt() ->> 'orgId'));

create index if not exists idx_intake_items_org on public.intake_items (org_id);

-- The review queue is read as "everything still pending, newest first", and the
-- matcher looks items up by source; index both paths out of the jsonb.
create index if not exists idx_intake_items_status
  on public.intake_items (org_id, (data ->> 'status'));
create index if not exists idx_intake_items_source
  on public.intake_items (org_id, (data ->> 'source'));

alter table public.intake_items replica identity full;

do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.intake_items';
  exception when duplicate_object then null;
  end;
end $$;
