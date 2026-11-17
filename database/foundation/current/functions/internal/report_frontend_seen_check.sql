-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.report_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;now_at timestamptz;products text;notes text;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');now_at:=clock_timestamp();
  if x.assigned_to is distinct from actor or x.owner_id=actor then raise exception 'assigned verifier required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.visit_report is not null then raise exception 'business check changed' using errcode='PT409';end if;
  if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>8000
    or exists(select 1 from jsonb_object_keys(p_report) k where k not in('outcome','identityConfirmed','signage','productsSeen','premisesType','notes','city'))
    or coalesce(p_report->>'outcome','') not in('seen','not_confirmed')
    or coalesce(p_report->>'premisesType','') not in('shop','home_based','market_stall','mobile_service','online_with_stock','office')
    or jsonb_typeof(p_report->'identityConfirmed') is distinct from 'boolean' or jsonb_typeof(p_report->'signage') is distinct from 'boolean'
    then raise exception 'valid business visit report required' using errcode='22023';end if;
  products:=internal.privacy_text(p_report->>'productsSeen',3,500);
  if nullif(p_report->>'notes','') is not null then notes:=internal.privacy_text(p_report->>'notes',1,1000);end if;
  if p_report->>'outcome'='seen' and (select count(*) from private.frontend_business_seen_photos p join private.evidence_artifacts a on a.id=p.artifact_id
    where p.check_id=x.id and p.verifier_id=actor and a.state='clean' and p.content_digest=a.content_sha256)<3
    then raise exception 'three distinct confirmed photographs required' using errcode='PT409';end if;
  update private.frontend_business_checks set visit_report=jsonb_build_object('outcome',p_report->>'outcome','identityConfirmed',p_report->'identityConfirmed',
    'signage',p_report->'signage','productsSeen',products,'premisesType',p_report->>'premisesType','notes',notes,
    'city',case when p_report->>'city' is not null then internal.privacy_text(p_report->>'city',1,80) end),
    report_by=actor,report_at=now_at,updated_at=now_at where id=x.id;
  update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('ok',true,'updatedAt',now_at);
end$function$;
alter function internal.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) owner to postgres;
revoke all on function internal.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) from public;
grant execute on function internal.report_frontend_seen_check(uuid,timestamp with time zone,jsonb) to authenticated;
