-- W6 DB bug-fix migrations — applied to prod Supabase (project nbvfgciyuuclgssnnzlt)
-- on 2026-06-10 via the Supabase MCP. Recorded here for git history.
-- Bugs: #609, #622, #366, #652, #653, #654. Verified post-apply with get_advisors
-- (0 auth_rls_initplan, 0 function_search_path_mutable, rls_auto_enable no longer public).
--
-- Applied as three migrations:
--   1. bugfix_rpc_allowlist_date_entered_search_path_execute
--   2. wrap_auth_jwt_in_rls_policies_perf
--   3. revoke_rls_auto_enable_from_public

-- ============================================================================
-- #609 / #622 — apply_doc_patch allowlist: add every org-scoped doc table the
-- write seam patches (orgUpdate -> sbUpdate -> apply_doc_patch); drop deleted 'diary'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.apply_doc_patch(p_table text, p_source_doc_id text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org text; v_data jsonb; v_new jsonb; v_append jsonb; v_key text; v_rows int;
begin
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'apply_doc_patch: no org claim'; end if;
  if p_table not in ('pow_tasks','maintenance_tickets','maintenance_parts','scooters',
    'repair_sessions','repair_procedures','projects','decision_gates','brainstorm_ideas',
    'issues','notifications','costs','app_config',
    'fleets','maintenance_schedules','bank_rules','users','organizations','invites','owner_ledger','loans') then
    raise exception 'apply_doc_patch: unsupported table %', p_table;
  end if;
  execute format('select data from public.%I where source_doc_id=$1 and org_id=$2', p_table)
    into v_data using p_source_doc_id, v_org;
  if v_data is null then raise exception 'apply_doc_patch: % not found', p_source_doc_id; end if;
  v_append := p_patch->'$append';
  v_new := v_data || (p_patch - '$append');
  if not (p_patch ? 'updatedAt') then
    v_new := v_new || jsonb_build_object('updatedAt', now()::text);
  end if;
  if v_append is not null then
    for v_key in select jsonb_object_keys(v_append) loop
      v_new := jsonb_set(v_new, array[v_key], coalesce(v_new->v_key, '[]'::jsonb) || (v_append->v_key));
    end loop;
  end if;
  execute format('update public.%I set data=$1 where source_doc_id=$2 and org_id=$3', p_table)
    using v_new, p_source_doc_id, v_org;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'updated', v_rows);
end $function$;

-- ============================================================================
-- #366 — sortable date_entered column on maintenance_tickets (immutable generated,
-- regex-guarded; malformed/missing dateEntered -> NULL). The capped tickets listener
-- now orderBy's it (see src/lib/supabaseRowMap.js SUPABASE_QUERY_MAP + MaintenanceContext).
-- ============================================================================
ALTER TABLE public.maintenance_tickets
  ADD COLUMN IF NOT EXISTS date_entered date
  GENERATED ALWAYS AS (
    CASE WHEN (data->>'dateEntered') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    THEN make_date(
      (substring(data->>'dateEntered' from 1 for 4))::int,
      (substring(data->>'dateEntered' from 6 for 2))::int,
      (substring(data->>'dateEntered' from 9 for 2))::int)
    ELSE NULL END
  ) STORED;

-- ============================================================================
-- #653 — rls_auto_enable() is an internal maintenance helper; revoke EXECUTE from the
-- public-facing roles AND from PUBLIC (the default grant). owner/service_role retain it.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;

-- ============================================================================
-- #654 — pin search_path on the three flagged functions (fixes mutable-search_path
-- security lint; pg_catalog is always implicitly first so behavior is unchanged).
-- ============================================================================
ALTER FUNCTION public.omni_pay_num(numeric) SET search_path = 'public';
ALTER FUNCTION public.omni_sync_created_at_ts() SET search_path = 'public';
ALTER FUNCTION public.omni_sync_repair_sessions() SET search_path = 'public';

-- ============================================================================
-- #652 — wrap auth.jwt() in (select auth.jwt()) across every RLS policy so it is
-- evaluated once per query instead of per row (auth_rls_initplan). Reads each live
-- policy and recreates it with ONLY that substitution (cmd/roles/permissive/USING/
-- WITH CHECK preserved verbatim). Atomic.
-- ============================================================================
DO $$
DECLARE
  r record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual LIKE '%auth.jwt()%' OR with_check LIKE '%auth.jwt()%')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    v_using := CASE WHEN r.qual IS NOT NULL
                    THEN replace(r.qual, 'auth.jwt()', '(select auth.jwt())') END;
    v_check := CASE WHEN r.with_check IS NOT NULL
                    THEN replace(r.with_check, 'auth.jwt()', '(select auth.jwt())') END;
    v_sql := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                    r.policyname, r.tablename, r.permissive, r.cmd,
                    array_to_string(r.roles, ', '));
    IF v_using IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_using || ')'; END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_check || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;
