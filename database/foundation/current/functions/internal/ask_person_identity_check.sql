-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ask_person_identity_check(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); explanation text; k private.identity_checks; a private.frontend_appeals;
begin
  explanation:=internal.validate_attribute_value('{"type":"string","minLength":20,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if p_check is null or explanation is null
    or explanation ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'appeal reason required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select x.* into k from private.identity_checks x where x.id=p_check and x.owner_id=actor for update;
  if not found then raise exception 'identity check unavailable' using errcode='PT409',detail='ask_person_unavailable'; end if;
  select x.* into a from private.frontend_appeals x where x.action_id=p_check;
  if found then
    if a.appellant_id=actor and a.reason=explanation and a.status='submitted' then
      return jsonb_build_object('appeal_id',a.id,'status','submitted','reused',true); end if;
    raise exception 'decision already appealed' using errcode='PT409'; end if;
  if not internal.identity_check_askable(k) then
    raise exception 'identity check cannot go to a person' using errcode='PT409',detail='ask_person_unavailable'; end if;
  insert into private.frontend_appeals(action_id,appellant_id,kind,reason)
    values(p_check,actor,'identity_check',explanation) returning * into a;
  insert into private.verification_current_submissions(case_id,submission_id) values(k.case_id,k.submission_id);
  update private.identity_checks set provider_delete_due=null where id=k.id;
  perform internal.price_draft_actor();
  return jsonb_build_object('appeal_id',a.id,'status','submitted');
end$function$;
alter function internal.ask_person_identity_check(uuid,text) owner to postgres;
revoke all on function internal.ask_person_identity_check(uuid,text) from public;
grant execute on function internal.ask_person_identity_check(uuid,text) to authenticated;
