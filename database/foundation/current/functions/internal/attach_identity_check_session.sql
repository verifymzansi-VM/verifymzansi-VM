-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.attach_identity_check_session(p_check uuid, p_session_id uuid, p_session_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks;
begin
  if p_check is null or p_session_id is null or p_session_url is null
    or p_session_url not like 'https://verify.didit.me/%' or char_length(p_session_url)>500 then
    raise exception 'identity check session required' using errcode='22023'; end if;
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or k.status<>'started' or k.expires_at<=clock_timestamp() then
    raise exception 'unfinished identity check required' using errcode='PT409'; end if;
  if k.session_id is not null then
    if (k.session_id,k.session_url)=(p_session_id,p_session_url) then
      return jsonb_build_object('check_id',k.id,'reused',true); end if;
    raise exception 'identity check already has a session' using errcode='PT409'; end if;
  update private.identity_checks set session_id=p_session_id,session_url=p_session_url where id=k.id;
  return jsonb_build_object('check_id',k.id,'reused',false);
end$function$;
alter function internal.attach_identity_check_session(uuid,uuid,text) owner to postgres;
revoke all on function internal.attach_identity_check_session(uuid,uuid,text) from public;
grant execute on function internal.attach_identity_check_session(uuid,uuid,text) to service_role;
