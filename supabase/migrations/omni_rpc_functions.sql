-- omni_rpc_functions (ADR-0015): Postgres RPCs replacing Firestore runTransaction.
-- All SECURITY DEFINER (bypass RLS) + an INTERNAL org guard (org_id = auth.jwt()->>'orgId')
-- on every touched row, so tenant isolation is self-enforced. grant execute to the
-- authenticated/anon roles PostgREST calls rpc() as. A plpgsql body = one transaction
-- (any RAISE rolls everything back — the Firestore runTransaction guarantee).

-- pay helper matching repairPayCalc.js `num()` (finite & >0 else 0)
create or replace function omni_pay_num(v numeric) returns numeric
language sql immutable as $$ select case when v is null or v <= 0 then 0 else v end $$;

-- ───────── complete_repair_session — the atomic repair-completion (THE risk) ─────────
-- Mirrors src/utils/repairSessionWriter.js exactly: lock ticket (guard not-Completed),
-- lock+validate ALL parts before any write, capture live unitCost (#445), compute pay
-- (computeRepairPay), decrement stock, update ticket (costStatus pending + activityLog
-- append), insert repair_sessions audit (idempotent on sessionId).
create or replace function complete_repair_session(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org text; v_ticket_id text := p_payload->>'ticketDocId';
  v_session_id text := p_payload->>'sessionId';
  v_ticket jsonb; v_part jsonb; v_part_elem jsonb;
  v_part_id text; v_qty numeric; v_stock numeric; v_unit numeric;
  v_parts_live jsonb := '[]'::jsonb; v_total_parts numeric := 0;
  v_est numeric  := omni_pay_num((p_payload->>'estimatedMinutes')::numeric);
  v_rate numeric := omni_pay_num((p_payload->>'labourRatePerHour')::numeric);
  v_xtra numeric := omni_pay_num((p_payload->>'extraMinutes')::numeric);
  v_labour_cost numeric; v_extra_cost numeric; v_total_cost numeric;
  v_completed text := p_payload->>'completedAt';
begin
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'complete_repair_session: no org claim'; end if;

  -- lock + guard ticket (read-set → concurrent completion serializes; BUG-422)
  select data into v_ticket from maintenance_tickets
    where source_doc_id = v_ticket_id and org_id = v_org for update;
  if v_ticket is null then raise exception 'Ticket % not found', v_ticket_id; end if;
  if v_ticket->>'status' = 'Completed' then
    raise exception 'Ticket already completed by %', coalesce(v_ticket->>'completedBy','another technician');
  end if;

  -- pass 1: lock every part, validate stock for ALL before any write, capture live unitCost
  for v_part_elem in select * from jsonb_array_elements(coalesce(p_payload->'aggregatedPartsUsed','[]'::jsonb)) loop
    v_part_id := v_part_elem->>'partId';
    v_qty := coalesce((v_part_elem->>'quantity')::numeric, 0);
    if v_part_id is null or v_qty = 0 then continue; end if;
    select data into v_part from maintenance_parts
      where source_doc_id = v_part_id and org_id = v_org for update;
    v_stock := coalesce((v_part->>'stockOnHand')::numeric, 0);
    if v_stock < v_qty then
      raise exception 'Insufficient stock for %: have %, need %',
        coalesce(v_part_elem->>'partName', v_part_id), v_stock, v_qty;
    end if;
    v_unit := coalesce((v_part->>'unitCost')::numeric, (v_part_elem->>'unitCost')::numeric, 0);
    v_parts_live := v_parts_live || jsonb_build_array(jsonb_build_object(
      'partId', v_part_id, 'partName', v_part_elem->>'partName',
      'quantity', v_qty, 'unitCost', v_unit));
    v_total_parts := v_total_parts + omni_pay_num(v_qty) * omni_pay_num(v_unit);
  end loop;
  v_total_parts := round(v_total_parts, 2);

  -- pass 2: decrement (every part validated; locks held from pass 1)
  for v_part_elem in select * from jsonb_array_elements(v_parts_live) loop
    update maintenance_parts set data = jsonb_set(data, '{stockOnHand}',
        to_jsonb(coalesce((data->>'stockOnHand')::numeric,0) - (v_part_elem->>'quantity')::numeric))
      where source_doc_id = v_part_elem->>'partId' and org_id = v_org;
  end loop;

  -- pay (matches computeRepairPay: labour = estimate×rate, not wall-clock)
  v_labour_cost := round((v_est/60)*v_rate, 2);
  v_extra_cost  := round((v_xtra/60)*v_rate, 2);
  v_total_cost  := round(v_labour_cost + v_extra_cost + v_total_parts, 2);

  update maintenance_tickets set data = data || jsonb_build_object(
    'status','Completed', 'dateCompleted', left(v_completed,10),
    'completedBy', p_payload->>'technicianUid', 'partsUsed', v_parts_live,
    'labourMinutes', (p_payload->>'labourMinutes')::numeric,
    'estimatedMinutes', v_est, 'labourRatePerHour', v_rate, 'extraMinutes', v_xtra,
    'extraWorkNote', p_payload->>'extraWorkNote', 'labourCost', v_labour_cost,
    'extraCost', v_extra_cost, 'totalPartsCost', v_total_parts, 'totalCost', v_total_cost,
    'costStatus','pending', 'sessionId', v_session_id, 'updatedAt', v_completed,
    'activityLog', coalesce(v_ticket->'activityLog','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'timestamp', v_completed, 'action','Repair completed by technician', 'by', p_payload->>'technicianName')))
  where source_doc_id = v_ticket_id and org_id = v_org;

  insert into repair_sessions (org_id, source_doc_id, data)
  values (v_org, v_session_id, jsonb_build_object(
    'orgId', v_org, 'ticketId', v_ticket_id, 'scooterId', p_payload->>'scooterId',
    'procedureId', p_payload->>'procedureId', 'technicianUid', p_payload->>'technicianUid',
    'technicianName', p_payload->>'technicianName', 'startedAt', p_payload->>'startedAt',
    'completedAt', v_completed, 'labourMinutes', (p_payload->>'labourMinutes')::numeric,
    'steps', coalesce(p_payload->'steps','[]'::jsonb), 'aggregatedPartsUsed', v_parts_live,
    'totalPartsCost', v_total_parts, 'estimatedMinutes', v_est, 'labourRatePerHour', v_rate,
    'extraMinutes', v_xtra, 'extraWorkNote', p_payload->>'extraWorkNote',
    'labourCost', v_labour_cost, 'extraCost', v_extra_cost, 'totalCost', v_total_cost,
    'costStatus','pending', 'approvedBy', null, 'approvedAt', null, 'rejectionReason', null,
    'signatureUrl', p_payload->>'signatureUrl', 'signedByName', p_payload->>'signedByName',
    'createdAt', v_completed))
  on conflict (source_doc_id) do nothing;

  return jsonb_build_object('ok', true, 'sessionId', v_session_id, 'totalCost', v_total_cost,
    'totalPartsCost', v_total_parts, 'labourCost', v_labour_cost, 'extraCost', v_extra_cost);
end $$;

-- ───────── toggle_assignee — PoW assignee toggle (mirrors PowContext.toggleAssignee) ─────────
create or replace function toggle_assignee(
  p_task_source_id text, p_person text, p_step_indices jsonb, p_current_week int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org text; v_data jsonb; v_current jsonb; v_assignees jsonb;
  v_pow_steps jsonb; v_pow_weeks jsonb; v_removing boolean; v_status text;
begin
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'toggle_assignee: no org claim'; end if;
  select data into v_data from pow_tasks
    where source_doc_id = p_task_source_id and org_id = v_org for update;
  if v_data is null then return jsonb_build_object('ok', true, 'noop', true); end if;

  v_current := coalesce(v_data->'assignees',
    case when v_data->>'assignee' is not null then jsonb_build_array(v_data->>'assignee') else '[]'::jsonb end);
  v_pow_steps := coalesce(v_data->'powSteps','{}'::jsonb);
  v_pow_weeks := coalesce(v_data->'powWeeks','{}'::jsonb);
  v_removing := (v_current ? p_person) and p_step_indices is null;

  if v_removing then
    select coalesce(jsonb_agg(e),'[]'::jsonb) into v_assignees
      from jsonb_array_elements_text(v_current) e where e <> p_person;
    v_pow_steps := v_pow_steps - p_person;
    v_pow_weeks := v_pow_weeks - p_person;
  else
    v_assignees := case when v_current ? p_person then v_current else v_current || jsonb_build_array(p_person) end;
    v_pow_steps := v_pow_steps || jsonb_build_object(p_person, coalesce(p_step_indices, '[]'::jsonb));
    v_pow_weeks := v_pow_weeks || jsonb_build_object(p_person, p_current_week);
  end if;
  v_status := case when jsonb_array_length(v_assignees) > 0 then 'pow' else 'backlog' end;

  update pow_tasks set data = data || jsonb_build_object(
    'assignees', v_assignees, 'powSteps', v_pow_steps, 'powWeeks', v_pow_weeks,
    'status', v_status, 'updatedAt', now()::text)
  where source_doc_id = p_task_source_id and org_id = v_org;
  return jsonb_build_object('ok', true);
end $$;

-- ───────── optimistic RMW (version-CAS) for the 12 ProjectContext orgTransaction ops ─────────
create or replace function rmw_read(p_table text, p_source_doc_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org text; v_data jsonb; v_version int;
begin
  if p_table <> 'projects' then raise exception 'rmw_read: unsupported table %', p_table; end if;
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'rmw_read: no org claim'; end if;
  select data, version into v_data, v_version from projects
    where source_doc_id = p_source_doc_id and org_id = v_org;
  return jsonb_build_object('found', v_data is not null,
    'data', coalesce(v_data,'{}'::jsonb), 'version', coalesce(v_version, 0));
end $$;

create or replace function rmw_commit(p_table text, p_source_doc_id text, p_patch jsonb, p_expected_version int)
returns int language plpgsql security definer set search_path = public as $$
declare v_org text; v_rows int;
begin
  if p_table <> 'projects' then raise exception 'rmw_commit: unsupported table %', p_table; end if;
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'rmw_commit: no org claim'; end if;
  update projects
    set data = data || p_patch || jsonb_build_object('updatedAt', now()::text), version = version + 1
    where source_doc_id = p_source_doc_id and org_id = v_org and version = p_expected_version;
  get diagnostics v_rows = row_count;
  return v_rows;  -- 0 = lost the race; seam re-reads + retries (≤5×)
end $$;

-- ───────── apply_doc_patch — orgUpdate shallow merge (+ $append for arrayUnion) ─────────
create or replace function apply_doc_patch(p_table text, p_source_doc_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org text; v_data jsonb; v_new jsonb; v_append jsonb; v_key text; v_rows int;
begin
  v_org := auth.jwt()->>'orgId';
  if v_org is null then raise exception 'apply_doc_patch: no org claim'; end if;
  if p_table not in ('pow_tasks','maintenance_tickets','maintenance_parts','scooters',
    'repair_sessions','repair_procedures','projects','decision_gates','brainstorm_ideas',
    'issues','notifications','diary','costs','app_config') then
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
end $$;

-- Grant execute to the roles PostgREST uses (RLS still self-enforced via the org guard).
grant execute on function omni_pay_num(numeric) to authenticated, anon;
grant execute on function complete_repair_session(jsonb) to authenticated, anon;
grant execute on function toggle_assignee(text, text, jsonb, int) to authenticated, anon;
grant execute on function rmw_read(text, text) to authenticated, anon;
grant execute on function rmw_commit(text, text, jsonb, int) to authenticated, anon;
grant execute on function apply_doc_patch(text, text, jsonb) to authenticated, anon;
