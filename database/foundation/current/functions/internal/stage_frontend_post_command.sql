-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.stage_frontend_post_command(p_owner uuid, p_request uuid, p_digest text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare prior private.frontend_post_commands;
begin
  if p_request is null or p_owner is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072
    or p_payload->>'request_id' is distinct from p_request::text then
    raise exception 'validated form command required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active member required' using errcode='42501'; end if;
  select * into prior from private.frontend_post_commands where owner_id=p_owner and request_id=p_request for update;
  if found then
    if prior.digest<>p_digest then raise exception 'form request changed; reload your posts before retrying' using errcode='PT409',detail='post_request_changed'; end if;
    if prior.result is null and prior.expires_at<=clock_timestamp() then raise exception 'form request expired' using errcode='PT409'; end if;
    return true;
  end if;
  insert into private.frontend_post_commands(owner_id,request_id,digest,payload) values(p_owner,p_request,p_digest,p_payload);
  return true;
end$function$;
alter function internal.stage_frontend_post_command(uuid,uuid,text,jsonb) owner to postgres;
revoke all on function internal.stage_frontend_post_command(uuid,uuid,text,jsonb) from public;
grant execute on function internal.stage_frontend_post_command(uuid,uuid,text,jsonb) to service_role;
