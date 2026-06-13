-- #660 — atomic toggle_step RPC for pow_tasks.checkedSteps.
-- Applied to prod Supabase (project nbvfgciyuuclgssnnzlt) on 2026-06-13 via the
-- Supabase MCP (migration `pow_toggle_step_rpc`). Recorded here for git history.
--
-- Background: PowContext.toggleStep was routed through orgTransaction (#632), whose
-- Supabase path uses rmw_read/rmw_commit — both HARDCODED to `projects` and dependent
-- on a `version` column pow_tasks does not have. So every step toggle raised
-- "unsupported table pow_tasks" and silently failed. This RPC does the read-modify-write
-- atomically (FOR UPDATE row lock), mirroring toggle_assignee, with no version column.

CREATE OR REPLACE FUNCTION public.toggle_step(p_task_source_id text, p_step_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org text; v_data jsonb; v_checked jsonb; v_new jsonb;
begin
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'toggle_step: no org claim'; end if;

  select data into v_data from public.pow_tasks
    where source_doc_id = p_task_source_id and org_id = v_org
    for update;
  if v_data is null then raise exception 'toggle_step: task % not found', p_task_source_id; end if;

  v_checked := coalesce(v_data->'checkedSteps', '[]'::jsonb);
  if v_checked @> to_jsonb(p_step_index) then
    select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_new
      from jsonb_array_elements(v_checked) elem
      where elem <> to_jsonb(p_step_index);
  else
    v_new := v_checked || jsonb_build_array(p_step_index);
  end if;

  update public.pow_tasks
    set data = data || jsonb_build_object('checkedSteps', v_new, 'updatedAt', now()::text)
    where source_doc_id = p_task_source_id and org_id = v_org;

  return jsonb_build_object('ok', true, 'checkedSteps', v_new);
end $function$;
