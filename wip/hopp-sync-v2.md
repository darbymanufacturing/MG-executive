# WIP — hopp-sync v2 rebuild

> ⛔ **SUPERSEDED (2026-06-10) — DO NOT ACT ON THE "NOT DONE / Phase 4" SECTIONS BELOW.**
> Validated truth: `North-Star.md` Pass 8 · `wip/agent-update-2026-06-10.md` · memory
> `project-cleanup-week-2026-06`. Reconcile against those, not this note.
>
> - **Hopp Phase-4 cutover is COMPLETE** (commit `6b306bd`): new `/api/hopp-refresh`
>   proxy; `useHoppSync` reads Supabase **`hopp_sync_runs`** (not Firestore `syncLogs`);
>   the legacy Vercel cron + `hopp-mcp-client.js` are **DELETED**; ENV `HOPP_MCP_URL` →
>   **`HOPP_SYNC_URL`**. The old `hopp-mcp.vercel.app` is retired. Phase 0/3/4 below = done/moot.
> - **The Oracle VM worker is INTENTIONALLY STOPPED** (Kostas, 2026-06-10): no auto Hopp
>   sync; the Refresh button returns **504 by design — do NOT "fix" it.** Worker revival /
>   retime / token re-bootstrap are **Kostas's deferred ops**, not an agent's to start.
>   Don't re-bootstrap Hopp tokens or revive the worker unless he explicitly asks.
> - This session's hopp-sync commits (rollup per-trip-city + 2 AM-Athens + paid-only
>   `61e0639`; Node 22 `050b277`; auth circuit-breaker + 30-min token keepalive) live in the
>   local `hopp-sync` repo but are **NOT running** (VM down).
> - ⚠️ **Observed this session (NOT Validator-confirmed):** the worker bootstraps from
>   Kostas's *browser* Hopp login, so they share one rotating token chain — his active
>   dashboard use invalidates the worker's token within ~45 min. If the worker is ever
>   revived, it needs its **own Hopp credential** (API key / 2nd operator login) to be
>   stable. (A stale `.mcp.json` at the repo root points at the stopped worker endpoint.)
>
> Everything below is **HISTORICAL (2026-06-03)**, kept for reference only.

**Role:** hopp-sync architect / Omni integration
**Session ended:** 2026-06-03 · **Superseded:** 2026-06-10 (see banner)
**Status (HISTORICAL):** Phase 1–3 built and compiling; Phases 0 + 4 then remained — now DONE/moot per banner

---

## What's done

### hopp-sync (new repo)
`C:\Users\kmarm\Desktop\Micromobility Greece\Claude App Building\hopp-sync\`

A fully compiled, git-committed, always-on worker that replaces the serverless
`hopp-mcp` + `_cron-hopp-sync.js`. Compiles clean (`tsc --noEmit` zero errors).
Initial commit: a452b1a.

Architecture in one line: one Node process, two surfaces (scheduler + MCP HTTP endpoint),
one datastore (Supabase service-role), no Firestore.

**What it does:**
- `src/auth.ts` — in-process single-flight mutex refresh, Supabase-persisted rotating token.
  THIS IS THE FIX for the cold-start token churn we fought all session.
- `src/hopp/` — 3 fetchers (trips, repairs, status) + `resolve.ts` (code→vehicleId harvest from issues)
- `src/sync/` — node-cron scheduler, cursor-based incremental windows, run logging, backfill command
- `src/mcp/` + `src/http.ts` — Streamable HTTP MCP (same tool names/shapes as old hopp-mcp)
- `src/store/` — Supabase write helpers + vendored `toSupabaseRow`/`orgDocId`/`rollup` from the app

### hopp-mcp (deployed at https://hopp-mcp.vercel.app)
The OLD MCP is still live and wired. New commits this session:
- `src/hopp/auth.ts` — Firestore token persistence (b2bb751)
- `AGENT_REFERENCE.md` — updated (6dda6ee, current HEAD)
- `scripts/refresh-hopp-token.mjs` — rewritten to use Vercel REST API (no more CLI churn)
Token is live as of 2026-06-03 (re-bootstrapped via browser JS during this session).

---

## NOT DONE — next steps in exact order

### Phase 0 — Discovery (do first, ½ day, before VM provisioning)

**Goal:** close the one unknown: does `allIssues.vehicle{id,code}` cover enough
of the active fleet for status events?

Steps:
1. Call `list_repair_events` (live MCP) with a wide window (since='2020-01-01')
   and collect every distinct scooterId returned.
2. Compare against the active scooter list in Supabase `scooters` table.
3. Any scooter that has no issues logged = status events won't work for it yet.
   If >10% of the active fleet is uncovered, escalate to a browser-automation
   vehicle-roster fallback (Playwright on the VM).
4. Also live-probe: `Vehicle(code: String)` single-vehicle resolver — the
   `hopp-mcp/src/hopp/vehicles.ts` on disk only has the broken `allVehicles`.
   A prior agent claimed a working `Vehicle(code)` query exists. Verify by running
   a raw GraphQL call from the browser console.
5. Commit a `DISCOVERY.md` note to hopp-sync with the findings.

### Phase 3 (final MCP config) — after VM is live
- Register `https://$HOPP_SYNC_DOMAIN/mcp` in Claude Desktop with the bearer token.
- Confirm `list_trips` output is identical to old hopp-mcp (spot-check revenue figures).

### Phase 4 — Omni cutover (main deliverable for scooter-fleet-costs)

Files to change in `scooter-fleet-costs/`:

1. **`api/_lib/hopp-mcp-client.js`** — change `HOPP_MCP_URL` default to the new
   VM endpoint. No signature change — `callHoppTool()` callers work unchanged.

2. **`src/hooks/useHoppSync.js`** — rewire to read run status from Supabase
   `hopp_sync_runs` instead of Firestore `syncLogs`. Currently subscribes to
   `syncLogs` collection; change to `useSupabaseLive('hopp_sync_runs', ...)` or a
   direct Supabase query ordered by `finished_at desc limit 1`.

3. **`api/_cron-hopp-sync.js`** — RETIRE. The new worker handles scheduling.
   Before retiring: run old + new in parallel for 2–3 days, compare
   `scooter_trips` row counts for the same window via Supabase SQL.

4. **`vercel.json`** — remove the cron entry for `_cron-hopp-sync`.

5. **`docs/ARCHITECTURE.md`** — update the data-flow diagram to show hopp-sync VM
   replacing the Vercel cron. The Firestore `hopp_cache` collection is now unused.

6. **`CHANGELOG.md`** — add entry under `[Unreleased]`.

7. **`DEV_CHECKLIST.md`** — mark Hopp sync as "always-on" / "Supabase-primary".

---

## Key decisions (made this session, not yet in ADR)

| Decision | Rationale |
|---|---|
| Always-on GCP e2-micro (not Vercel) | Eliminates cold-start token churn; e2-micro Always-Free tier = ~$0 after €300 trial |
| Supabase-only (no Firestore) | Omni cut over to Supabase as production default (ADR-0015 2026-06-02); Firestore is rollback store |
| In-process mutex for auth | Single long-lived process; no distributed lock needed; one-time-use refresh token can't be raced |
| Vehicle map from issues feed | `allIssues.vehicle{id,code}` is the only unblocked code→id path; `allVehicles` returns INTERNAL_ERROR |
| Vehicle roster deferred | Closing the remaining coverage gap requires browser automation (Playwright); deferred to future feature |
| Paid revenue as default metric | Franchisee explicit preference — never show gross revenue as a headline; always filter to `isPaid=true` |

---

## Critical files

| File | What to know |
|---|---|
| `hopp-sync/src/auth.ts` | The bulletproof auth. Single-flight mutex + Supabase persistence. This is the core architectural fix. |
| `hopp-sync/src/hopp/resolve.ts` | `code→vehicleId` harvest from issues. Has a known gap (scooters with no issues). |
| `hopp-sync/supabase/migrations/hopp_sync_state.sql` | MUST be applied before the worker can boot. Two tables: `hopp_sync_state` + `hopp_sync_runs`. |
| `hopp-sync/src/scripts/bootstrap-token.ts` | One-time token seed: `npm run bootstrap-token -- <refreshToken>` |
| `hopp-sync/README.md` | Full deploy runbook (GCP VM, Caddy, Supabase migration, bootstrap). |
| `scooter-fleet-costs/src/hooks/useHoppSync.js` | Reads Firestore `syncLogs` — needs to be rewired to `hopp_sync_runs` in Phase 4. |

---

## Blockers

None hard. The one conditional:
- If Phase 0 shows <70% vehicle coverage from the issues harvest → add the Playwright
  vehicle-roster fallback to `hopp-sync/src/hopp/resolve.ts` before deploying.
