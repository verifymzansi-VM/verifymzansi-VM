-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_my_communication_choices(p_wording text, p_marketing_email boolean DEFAULT NULL::boolean, p_marketing_sms boolean DEFAULT NULL::boolean, p_analytics boolean DEFAULT NULL::boolean, p_third_party_sharing boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); current_choices jsonb; wanted jsonb; changes integer; recent integer;
begin
  if p_wording is null or p_wording !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'invalid wording version' using errcode='22023', detail='choice_invalid';
  end if;
  if num_nonnulls(p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing) = 0 then
    raise exception 'no choice given' using errcode='22023', detail='choice_invalid';
  end if;
  -- One save at a time per account, then the member check again after the wait.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1707));
  perform internal.price_draft_actor();
  current_choices:=internal.communication_choices_dto(actor);
  wanted:=jsonb_strip_nulls(jsonb_build_object('marketing_email', p_marketing_email,
    'marketing_sms', p_marketing_sms, 'analytics', p_analytics, 'third_party_sharing', p_third_party_sharing));
  select count(*) into changes from jsonb_each(wanted) w where w.value is distinct from current_choices -> w.key;
  if changes > 0 then
    select count(*) into recent from private.communication_choice_events e
      where e.account_id = actor and e.recorded_at > statement_timestamp() - interval '24 hours';
    if recent + changes > 40 then
      raise exception 'too many changes today; try again tomorrow' using errcode='PT429', detail='choice_limit';
    end if;
    insert into private.communication_choice_events (account_id, purpose, granted, wording_version)
      select actor, w.key, w.value::boolean, p_wording from jsonb_each(wanted) w
      where w.value is distinct from current_choices -> w.key
      order by w.key;
  end if;
  return internal.communication_choices_dto(actor);
end;
$function$;
alter function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) owner to postgres;
revoke all on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) from public;
grant execute on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) to authenticated;
