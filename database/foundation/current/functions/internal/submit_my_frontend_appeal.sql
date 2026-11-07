-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_my_frontend_appeal(p_action uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.frontend_self_review_actor();explanation text;x private.frontend_appealable_actions;a private.frontend_appeals;
begin
  explanation:=internal.validate_attribute_value('{"type":"string","minLength":20,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if explanation is null or explanation ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'appeal reason required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);
  perform internal.frontend_self_review_actor();
  select * into x from private.frontend_appealable_actions where id=p_action and account_id=actor;
  if not found or not x.appealable then raise exception 'decision cannot be appealed' using errcode='PT409';end if;
  select * into a from private.frontend_appeals where action_id=p_action;
  if found then
    if a.appellant_id=actor and a.reason=explanation and a.status='submitted'
      then return jsonb_build_object('appeal_id',a.id,'status','submitted','reused',true);end if;
    raise exception 'decision already appealed' using errcode='PT409';
  end if;
  insert into private.frontend_appeals(action_id,appellant_id,kind,reason) values(p_action,actor,x.kind,explanation) returning * into a;
  return jsonb_build_object('appeal_id',a.id,'status','submitted');
end$function$;
alter function internal.submit_my_frontend_appeal(uuid,text) owner to postgres;
revoke all on function internal.submit_my_frontend_appeal(uuid,text) from public;
grant execute on function internal.submit_my_frontend_appeal(uuid,text) to authenticated;
