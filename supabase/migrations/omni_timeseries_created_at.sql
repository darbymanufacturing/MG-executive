-- omni_timeseries_created_at
-- Bug #389: Add created_at timestamptz column + composite (org_id, created_at DESC) index
-- to the 5 time-series tables that were created before the operational-data-layer pattern.
-- The DB DEFAULT handles population automatically on INSERT — no changes to supabaseRowMap.js needed.
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

-- 1. telemetry_events
alter table public.telemetry_events
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_telemetry_events_org_created
  on public.telemetry_events (org_id, created_at desc);

-- 2. scooter_trips
alter table public.scooter_trips
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_scooter_trips_org_created
  on public.scooter_trips (org_id, created_at desc);

-- 3. spr_events
alter table public.spr_events
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_spr_events_org_created
  on public.spr_events (org_id, created_at desc);

-- 4. spr_weather
alter table public.spr_weather
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_spr_weather_org_created
  on public.spr_weather (org_id, created_at desc);

-- 5. revenue_days
alter table public.revenue_days
  add column if not exists created_at timestamptz not null default now();
create index if not exists idx_revenue_days_org_created
  on public.revenue_days (org_id, created_at desc);
