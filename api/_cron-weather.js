/**
 * api/cron-weather.js — daily weather for SPR (Spot Performance & Rebalancing).
 * Autopilot Phase 4 (docs/AUTOMATION_PLAN.md).
 *
 * Until now weather only existed if someone opened SPR → Weather, picked a date
 * range and pressed "Fetch" then "Save" — so most days had none, and the SPR
 * "exclude rainy days" filter silently degraded. This job fetches the last week
 * for every city centre configured in SPR, every day, from Open-Meteo (free, no
 * key). Re-fetching overlapping days is harmless: rows upsert on the same
 * deterministic id the SPR panel uses (orgDocId(org, date, city)).
 *
 * Trigger: Vercel cron (Bearer CRON_SECRET) or an admin, manually.
 */
import { requireCronOrUser, requireOrgMember } from './_lib/require-auth.js';
import { supabaseAdmin } from './_lib/supabase-admin.js';
import { heartbeatOk, heartbeatFail } from './_lib/heartbeat.js';
import { intakeOrgId } from './_lib/intake-store.js';
import { SUPABASE_TABLE, toSupabaseRow } from '../src/lib/supabaseRowMap.js';
import { orgDocId } from '../src/utils/orgDocId.js';
import { fetchRecentWeather } from '../src/utils/openMeteo.js';

const HEARTBEAT_ENV = 'HEARTBEAT_WEATHER';
const PAST_DAYS = 7;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireCronOrUser(req, res);
  if (!auth) return;

  const orgId = intakeOrgId();
  if (!requireOrgMember(auth, orgId, res)) return;
  const report = { cities: [], rows: 0, errors: [] };

  try {
    const supa = supabaseAdmin();
    const { data: cfgRow, error: cfgErr } = await supa
      .from(SUPABASE_TABLE.config)
      .select('data')
      .eq('source_doc_id', `${orgId}_spr`)
      .maybeSingle();
    if (cfgErr) throw new Error(`spr config: ${cfgErr.message}`);

    const centers = cfgRow?.data?.cityCenters || {};
    const cities = Object.entries(centers).filter(([, c]) => Number.isFinite(Number(c?.lat)) && Number.isFinite(Number(c?.lon)));
    if (!cities.length) {
      // Nothing configured is not a failure of this job — say so plainly.
      await heartbeatOk(HEARTBEAT_ENV, 'no SPR city centres configured');
      return res.status(200).json({ ok: true, skipped: 'no SPR city centres configured (SPR → Zones)' });
    }

    for (const [city, { lat, lon }] of cities) {
      try {
        const days = await fetchRecentWeather({ lat: Number(lat), lon: Number(lon), pastDays: PAST_DAYS });
        const rows = days.map((day) => {
          const docId = orgDocId(orgId, day.date, city);
          return toSupabaseRow('sprWeather', orgId, docId, {
            ...day, city, orgId, createdByUid: 'autopilot',
          });
        });
        if (rows.length) {
          const { error } = await supa
            .from(SUPABASE_TABLE.sprWeather)
            .upsert(rows, { onConflict: 'source_doc_id' });
          if (error) throw new Error(error.message);
        }
        report.cities.push(city);
        report.rows += rows.length;
      } catch (err) {
        report.errors.push(`${city}: ${err?.message || err}`);
      }
    }

    if (report.errors.length) await heartbeatFail(HEARTBEAT_ENV, report.errors.join(' | ').slice(0, 300));
    else await heartbeatOk(HEARTBEAT_ENV, `cities=${report.cities.length} rows=${report.rows}`);

    return res.status(200).json({ ok: report.errors.length === 0, ...report });
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[cron-weather]', message);
    await heartbeatFail(HEARTBEAT_ENV, message.slice(0, 200));
    return res.status(500).json({ ok: false, error: message });
  }
}
