-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_identity_check_mode(p_mode text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('identity_check:configure'); clean_reason text:=btrim(p_reason);
  s private.identity_check_settings; resumed boolean;
begin
  if p_mode is null or p_mode not in('manual','staff_final','automatic') then
    raise exception 'identity check mode required' using errcode='22023'; end if;
  if clean_reason is null or char_length(clean_reason) not between 5 and 500
    or clean_reason ~ U&'[\0001-\001F\007F\202A-\202E\2066-\2069\FEFF]' then
    raise exception 'identity check mode reason required' using errcode='22023'; end if;
  if p_mode<>'manual' then
    raise exception 'automatic identity checks wait for the retention update' using errcode='PT409',
      detail='identity_check_retention_pending'; end if;
  select x.* into s from private.identity_check_settings x where x.id for update;
  if not found then raise exception 'identity check settings missing' using errcode='55000'; end if;
  resumed:=s.paused_until>clock_timestamp();
  update private.identity_check_settings set mode=p_mode,paused_until=null,pause_reason=null,
    changed_at=case when mode<>p_mode then statement_timestamp() else changed_at end where id;
  if s.mode<>p_mode then
    insert into private.identity_check_mode_events(from_mode,to_mode,changed_by,reason)
      values(s.mode,p_mode,actor,clean_reason);
  end if;
  perform internal.staff_actor('identity_check:configure');
  return jsonb_build_object('mode',p_mode,'changed',s.mode<>p_mode,'resumed',coalesce(resumed,false));
end$function$;
alter function internal.set_identity_check_mode(text,text) owner to postgres;
revoke all on function internal.set_identity_check_mode(text,text) from public;
grant execute on function internal.set_identity_check_mode(text,text) to authenticated;
