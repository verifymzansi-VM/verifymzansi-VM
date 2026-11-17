-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.mark_frontend_cipc_email_sent(p_owner uuid, p_session uuid, p_case uuid, p_challenge uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare x private.frontend_business_checks;
begin
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  x:=internal.lock_frontend_cipc_case(p_case);
  if x.owner_id<>p_owner then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  update private.frontend_cipc_email_codes c set sent_at=coalesce(c.sent_at,clock_timestamp())
    where c.check_id=x.id and c.challenge=p_challenge and c.expires_at>clock_timestamp();
  return found;
end$function$;
alter function internal.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function internal.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) from public;
grant execute on function internal.mark_frontend_cipc_email_sent(uuid,uuid,uuid,uuid) to service_role;
