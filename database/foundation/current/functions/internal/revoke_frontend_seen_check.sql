-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.revoke_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_note text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('decision:approve');subject uuid;x private.frontend_business_checks;now_at timestamptz;notes text;
begin
  notes:=internal.privacy_text(p_note,5,1000);
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,80}$' then raise exception 'a reason for revocation is required' using errcode='22023';end if;
  select owner_id into subject from private.frontend_business_checks where id=p_case;
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('decision:approve');
  if actor=subject then raise exception 'independent revocation required' using errcode='42501';end if;
  select * into x from private.frontend_business_checks where id=p_case and kind='seen' for update;
  if not found or x.status<>'approved' or x.updated_at is distinct from p_expected then raise exception 'business check changed' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  update private.frontend_business_checks set status='withdrawn',expires_at=null,revoked_at=now_at,review_note=notes,reason_code=p_reason,updated_at=now_at where id=x.id;
  insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',notes);
  perform internal.staff_actor('decision:approve');
  return jsonb_build_object('caseId',x.id,'status','withdrawn');
end$function$;
alter function internal.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) owner to postgres;
revoke all on function internal.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) from public;
grant execute on function internal.revoke_frontend_seen_check(uuid,timestamp with time zone,text,text) to authenticated;
