-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.resolve_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid, p_outcome text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('report:resolve'); s record; note text;
begin
  if p_outcome is null or p_outcome not in ('resolved', 'dismissed') then
    raise exception 'outcome must be resolved or dismissed' using errcode = '22023';
  end if;
  note := internal.validate_attribute_value('{"type":"string","minLength":5,"maxLength":500}'::jsonb, to_jsonb(p_note)) #>> '{}';
  if note ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'remove hidden formatting characters' using errcode = '22023';
  end if;
  select * into s from internal.lock_queue_subject('report', p_report_id);
  actor := internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor, null, p_report_id) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.consume_queue_claim('report', p_report_id, actor, p_claim_generation, p_claim_nonce);
  perform internal.staff_actor('report:resolve'); -- authority after the claim-row wait
  update private.reports set status = p_outcome, resolution_note = note, resolved_by = actor,
    resolved_at = statement_timestamp()
  where id = p_report_id;
  return jsonb_build_object('id', p_report_id, 'status', p_outcome);
end;
$function$;
alter function internal.resolve_report(uuid,text,uuid,text,text) owner to postgres;
revoke all on function internal.resolve_report(uuid,text,uuid,text,text) from public;
grant execute on function internal.resolve_report(uuid,text,uuid,text,text) to authenticated;
