-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_frontend_cipc_email(p_owner uuid, p_session uuid, p_business uuid, p_case uuid, p_email text, p_position text, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare x private.frontend_business_checks;email text:=lower(btrim(p_email));pos text;challenge uuid;now_at timestamptz;
begin
  if not internal.frontend_cipc_owner_session(p_owner,p_session) then raise exception 'live owner session required' using errcode='42501';end if;
  pos:=internal.privacy_text(p_position,2,40);
  if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'valid work email required' using errcode='22023';end if;
  x:=internal.lock_frontend_cipc_case(p_case);now_at:=clock_timestamp();
  if x.owner_id<>p_owner or x.business_id<>p_business or not internal.frontend_cipc_owner_session(p_owner,p_session)
    or not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=x.id and d.route='representative' and d.submitted_at is not null)
    then raise exception 'open representative case unavailable' using errcode='PT404';end if;
  if exists(select 1 from private.frontend_cipc_email_codes c where c.check_id=x.id and c.started_at>now_at-interval '1 minute')
    then raise exception 'wait before requesting another code' using errcode='PT429';end if;
  insert into private.frontend_cipc_email_codes(check_id,digest,expires_at,started_at)
    values(x.id,p_digest,now_at+interval '15 minutes',now_at)
    on conflict(check_id) do update set digest=excluded.digest,expires_at=excluded.expires_at,started_at=excluded.started_at,
      challenge=gen_random_uuid(),sent_at=null,attempts=0 returning frontend_cipc_email_codes.challenge into challenge;
  update private.frontend_cipc_reviews set representative_email=email,representative_position=pos,representative_verified_at=null,
    domain_confirmed=false,callback_confirmed=false,callback_record=null where check_id=x.id;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  return jsonb_build_object('challenge',challenge);
end$function$;
alter function internal.start_frontend_cipc_email(uuid,uuid,uuid,uuid,text,text,text) owner to postgres;
revoke all on function internal.start_frontend_cipc_email(uuid,uuid,uuid,uuid,text,text,text) from public;
grant execute on function internal.start_frontend_cipc_email(uuid,uuid,uuid,uuid,text,text,text) to service_role;
