-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.resolve_frontend_appeal(p_appeal uuid, p_outcome text, p_reason text, p_effect_version integer DEFAULT NULL::integer, p_shorten_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('appeal:decide');review_reason text;subject uuid;a private.frontend_appeals;
  x private.frontend_appealable_actions;changed integer:=0;now_at timestamptz;
begin
  if p_outcome is null or p_outcome not in('upheld','overturned','partially_overturned','dismissed')
    or ((p_outcome='partially_overturned')<>(p_shorten_to is not null)) then raise exception 'valid appeal outcome required' using errcode='22023';end if;
  review_reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":2000}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if review_reason is null or review_reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'appeal outcome reason required' using errcode='22023';end if;
  select appellant_id into subject from private.frontend_appeals where id=p_appeal;
  if not found then raise exception 'appeal unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into a from private.frontend_appeals where id=p_appeal for update;
  select * into x from private.frontend_appealable_actions where id=a.action_id and account_id=subject;
  actor:=internal.staff_actor('appeal:decide');
  if not found or x.id is null or a.kind<>x.kind then raise exception 'appealed decision changed' using errcode='PT409';end if;
  if actor in(subject,x.actor_id,x.approver_id,x.reporter_id) then raise exception 'independent appeal reviewer required' using errcode='42501';end if;
  if a.status<>'submitted' then
    if a.reviewer_id=actor and a.status=p_outcome and a.reviewer_rationale=review_reason and a.shorten_to is not distinct from p_shorten_to
      and a.resolution_effect_version is not distinct from p_effect_version
      then return jsonb_build_object('appeal_id',a.id,'status',a.status,'restrictions_changed',a.effects_changed,'reused',true);end if;
    raise exception 'appeal already resolved' using errcode='PT409';
  end if;
  if x.effect_version is distinct from p_effect_version then raise exception 'appeal effect changed' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  if p_outcome='partially_overturned' then
    if x.kind<>'suspension' or not x.active or p_shorten_to>=x.ends_at or x.effect_version>=2147483647
      then raise exception 'a shorter active suspension is required' using errcode='PT409';end if;
    if p_shorten_to<=now_at then
      perform internal.lift_frontend_account_restriction(x.effect_id,x.effect_version,'Appeal reduced this suspension to time served.');
    else
      update private.frontend_account_restrictions set ends_at=p_shorten_to,version=version+1 where id=x.effect_id;
    end if;
    changed:=1;
  elsif p_outcome='overturned' and x.active then
    if x.kind='content_hidden' then
      perform internal.release_frontend_content_hold(x.effect_id,x.effect_version,'Independent appeal overturned the content hold.');
    elsif x.kind in('suspension','ban') then
      perform internal.lift_frontend_account_restriction(x.effect_id,x.effect_version,'Independent appeal overturned the restriction.');
      changed:=1;
    end if;
  end if;
  update private.frontend_appeals set status=p_outcome,reviewer_id=actor,reviewer_rationale=review_reason,
    resolved_at=now_at,shorten_to=p_shorten_to,effects_changed=changed,resolution_effect_version=p_effect_version where id=a.id;
  perform internal.staff_actor('appeal:decide');
  return jsonb_build_object('appeal_id',a.id,'status',p_outcome,'restrictions_changed',changed);
end$function$;
alter function internal.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) owner to postgres;
revoke all on function internal.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) from public;
grant execute on function internal.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) to authenticated;
