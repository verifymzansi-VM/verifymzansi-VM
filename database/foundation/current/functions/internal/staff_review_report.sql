-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_review_report(p_report_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('report:resolve'); c private.queue_claims; r private.reports; result jsonb;
begin
  -- Never acquire base-post locks after holding a report: deletion takes the
  -- post first and its report FK second. Return current public data or null.
  select * into r from private.reports x where x.id=p_report_id for update;
  actor:=internal.staff_actor('report:resolve');
  c:=internal.lock_queue_claim(null,r.id);
  actor:=internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report_id) then
    raise exception 'self-review is not allowed' using errcode='42501';
  end if;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  if r.status is distinct from 'open' then
    raise exception 'current live queue claim required' using errcode='42501';
  end if;
  if r.report_origin='staff' then
    result:=jsonb_build_object('id',r.id,'origin','staff','category','duplicate_event',
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'post_a',jsonb_build_object('id',r.duplicate_post_a,'reported_revision',r.duplicate_revision_a,
        'current',internal.duplicate_public_event_view(r.duplicate_post_a)),
      'post_b',jsonb_build_object('id',r.duplicate_post_b,'reported_revision',r.duplicate_revision_b,
        'current',internal.duplicate_public_event_view(r.duplicate_post_b)));
  else
    result:=jsonb_build_object('id',r.id,'category',r.category,'severity',r.severity,
      'description',r.description,'status',r.status,'created_at',r.created_at,
      'reporter_signed_in',r.reporter_id is not null,'subject_account_id',r.subject_account_id,
      'subject_open_reports',(select count(*) from private.reports x
        where x.subject_account_id=r.subject_account_id and x.status='open'),
      'post',case when r.post_id is not null then internal.post_review_view(r.post_id) end);
  end if;
  perform internal.staff_actor('report:resolve');
  select q.* into c from private.queue_claims q where q.report_id=r.id;
  perform internal.assert_queue_claim(c,actor,p_claim_generation,p_claim_nonce);
  return result;
end;
$function$;
alter function internal.staff_review_report(uuid,text,uuid) owner to postgres;
revoke all on function internal.staff_review_report(uuid,text,uuid) from public;
grant execute on function internal.staff_review_report(uuid,text,uuid) to authenticated;
