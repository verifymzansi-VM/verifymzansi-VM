-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_frontend_cipc_callback(p_case uuid, p_expected timestamp with time zone, p_generation text, p_nonce uuid, p_domain boolean, p_callback jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');x private.frontend_business_checks;c private.evidence_cases;now_at timestamptz;record_body jsonb;position text;
begin
  x:=internal.lock_frontend_cipc_case(p_case);actor:=internal.staff_actor('evidence:view');now_at:=clock_timestamp();
  if actor=x.owner_id or p_domain is null then raise exception 'independent callback confirmation required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'represented CIPC case changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_callback is null or jsonb_typeof(p_callback)<>'object' or octet_length(p_callback::text)>10000
    or exists(select 1 from jsonb_object_keys(p_callback) k where k not in('numberSource','spokeTo','confirmedPosition','confirmed','notes'))
    or jsonb_typeof(p_callback->'confirmed') is distinct from 'boolean'
    then raise exception 'valid callback record required' using errcode='22023';end if;
  position:=internal.privacy_text(p_callback->>'confirmedPosition',2,40);
  record_body:=jsonb_build_object('numberSource',internal.privacy_text(p_callback->>'numberSource',5,200),
    'spokeTo',internal.privacy_text(p_callback->>'spokeTo',2,120),'confirmedPosition',position,
    'confirmed',p_callback->'confirmed','notes',case when nullif(p_callback->>'notes','') is not null then internal.privacy_text(p_callback->>'notes',1,1000) end,
    'by',actor,'at',now_at);
  update private.frontend_cipc_reviews set domain_confirmed=p_domain,representative_position=position,
    callback_confirmed=(p_callback->>'confirmed')::boolean,callback_record=record_body
    where check_id=x.id and route='representative' and representative_verified_at is not null;
  if not found then raise exception 'the representative must verify their work email first' using errcode='PT409';end if;
  update private.frontend_business_checks set updated_at=now_at where id=x.id;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('ok',true,'confirmed',p_domain and (p_callback->>'confirmed')::boolean);
end$function$;
alter function internal.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) owner to postgres;
revoke all on function internal.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) from public;
grant execute on function internal.record_frontend_cipc_callback(uuid,timestamp with time zone,text,uuid,boolean,jsonb) to authenticated;
