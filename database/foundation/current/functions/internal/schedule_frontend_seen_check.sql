-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.schedule_frontend_seen_check(p_case uuid, p_expected timestamp with time zone, p_scheduled timestamp with time zone, p_generation text DEFAULT NULL::text, p_nonce uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;c private.evidence_cases;now_at timestamptz;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');now_at:=clock_timestamp();
  if x.owner_id=actor then raise exception 'self review is not allowed' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.visit_report is not null then raise exception 'business check changed' using errcode='PT409';end if;
  if p_scheduled is null or not isfinite(p_scheduled) or p_scheduled<now_at-interval '1 hour' then raise exception 'choose a future check time' using errcode='22023';end if;
  if x.assigned_to is distinct from actor then
    if x.assigned_to is not null then perform internal.staff_actor('decision:approve');end if;
    select * into c from private.evidence_cases where id=x.id;
    perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  end if;
  update private.frontend_business_checks set assigned_to=actor,scheduled_for=p_scheduled,updated_at=now_at where id=x.id;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('ok',true,'updatedAt',now_at);
end$function$;
alter function internal.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) owner to postgres;
revoke all on function internal.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) from public;
grant execute on function internal.schedule_frontend_seen_check(uuid,timestamp with time zone,timestamp with time zone,text,uuid) to authenticated;
