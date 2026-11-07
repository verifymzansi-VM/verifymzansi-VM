-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_frontend_staff_items(p_queue text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;items jsonb:='[]'::jsonb;answer jsonb;r record;
begin
  if p_queue is null or p_queue not in('content','reports','kyc','business_kyc') or p_limit is null or p_limit not between 1 and 25 then
    raise exception 'bounded staff queue required' using errcode='22023';end if;
  if p_queue in('content','reports') then
    items:=internal.claim_queue_items(p_queue,p_limit);
  else
    actor:=internal.staff_actor('case:claim');
    -- Lock each subject before its evidence case, as the native claim command
    -- does. A busy candidate is skipped; no failed mutation is replayed.
    for r in select c.id,c.subject_id from private.evidence_cases c
      left join private.verification_current_submissions v on v.case_id=c.id
      left join private.verification_identity_submissions s on s.id=v.submission_id and s.case_version=c.version
      where c.status='open' and c.kind=case p_queue when 'kyc' then 'kyc' else 'business' end and c.subject_id<>actor
      and (c.claimed_by is null or c.claim_expires_at<=clock_timestamp())
      and ((c.kind='kyc' and s.id is not null) or (c.kind='business' and ((exists(select 1 from private.frontend_cipc_reviews d join private.frontend_business_checks x on x.id=d.check_id
      where d.check_id=c.id and d.submitted_at is not null and x.status='pending')
     or (not exists(select 1 from private.frontend_cipc_reviews d where d.check_id=c.id)
       and exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose='registration' and a.state='clean')))
      or exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind='seen' and x.status='pending'
        and (x.assigned_to is null or x.visit_report is not null)))))
      order by coalesce(s.risk_score,0) desc,coalesce(s.created_at,c.created_at),c.id limit p_limit*2
    loop
      if not pg_try_advisory_xact_lock(hashtextextended(r.subject_id::text,2408)) then continue;end if;
      begin answer:=internal.claim_evidence_case(r.id);
      exception when sqlstate 'PT409' or sqlstate '22023' then continue;end;
      items:=items||jsonb_build_array(answer);
      exit when jsonb_array_length(items)>=p_limit;
    end loop;
    perform internal.staff_actor('case:claim');
  end if;
  return jsonb_build_object('items',items,'lease_minutes',case when p_queue in('content','reports') then 15 else 30 end);
end$function$;
alter function internal.claim_frontend_staff_items(text,integer) owner to postgres;
revoke all on function internal.claim_frontend_staff_items(text,integer) from public;
grant execute on function internal.claim_frontend_staff_items(text,integer) to authenticated;
