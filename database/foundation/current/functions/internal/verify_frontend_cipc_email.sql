-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.verify_frontend_cipc_email(p_owner uuid, p_session uuid, p_business uuid, p_case uuid, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare x private.frontend_business_checks;c private.frontend_cipc_email_codes;now_at timestamptz;
begin
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'valid code digest required' using errcode='22023';end if;
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  x:=internal.lock_frontend_cipc_case(p_case);now_at:=clock_timestamp();
  if x.owner_id<>p_owner or x.business_id<>p_business or not internal.frontend_cipc_owner_session(p_owner,p_session)
    then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  select * into c from private.frontend_cipc_email_codes where check_id=x.id for update;
  if not found or c.sent_at is null or c.expires_at<=now_at or c.attempts>=5
    then return jsonb_build_object('verified',false,'remaining',0);end if;
  if c.digest<>p_digest then
    update private.frontend_cipc_email_codes set attempts=attempts+1 where check_id=x.id;
    return jsonb_build_object('verified',false,'remaining',4-c.attempts);
  end if;
  update private.frontend_cipc_reviews set representative_verified_at=now_at where check_id=x.id and route='representative';
  if not found then raise exception 'representative route changed' using errcode='PT409';end if;
  delete from private.frontend_cipc_email_codes where check_id=x.id;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  return jsonb_build_object('verified',true,'remaining',0);
end$function$;
alter function internal.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) owner to postgres;
revoke all on function internal.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) from public;
grant execute on function internal.verify_frontend_cipc_email(uuid,uuid,uuid,uuid,text) to service_role;
