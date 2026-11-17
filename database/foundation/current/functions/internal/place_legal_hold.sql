-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.place_legal_hold(p_subject_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('legal_hold:manage'); h private.legal_holds;
begin
  if p_subject_id = actor then raise exception 'cannot hold own account' using errcode = '42501'; end if;
  perform internal.lock_evidence_subject(p_subject_id);
  actor:=internal.staff_actor('legal_hold:manage');
  insert into private.legal_holds (subject_id, reason, placed_by) values (p_subject_id, p_reason, actor) returning * into h;
  return jsonb_build_object('hold_id', h.id);
end;
$function$;
alter function internal.place_legal_hold(uuid,text) owner to postgres;
revoke all on function internal.place_legal_hold(uuid,text) from public;
grant execute on function internal.place_legal_hold(uuid,text) to authenticated;
