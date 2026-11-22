-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_identity_check_deletions(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare rows jsonb; now_at timestamptz:=clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'limit 1 to 100' using errcode='22023'; end if;
  update private.identity_checks set status='not_finished',finished_at=now_at,
    provider_delete_due=case when session_id is not null then now_at end
    where status='started' and expires_at<now_at-interval '1 hour';
  update private.identity_checks k set provider_delete_due=f.reviewed_at+interval '30 days'
    from private.accepted_identity_facts f
    where f.submission_id=k.submission_id and k.provider_delete_due is null and k.provider_deleted_at is null
      and k.session_id is not null;
  update private.identity_checks k set provider_delete_due=now_at+interval '5 days'
    where k.status in('with_staff','declined') and k.provider_delete_due is null and k.provider_deleted_at is null
      and k.session_id is not null
      and not exists(select 1 from private.accepted_identity_facts f where f.submission_id=k.submission_id)
      and not internal.identity_submission_waiting(k.submission_id);
  with due as (
    select k.id from private.identity_checks k
    where k.provider_delete_due<=now_at and k.provider_deleted_at is null and k.session_id is not null
      and not exists(select 1 from private.legal_holds h where h.subject_id=k.owner_id and h.released_at is null)
      and not internal.evidence_fraud_held(k.case_id)
    order by k.provider_delete_due,k.id limit p_limit for update skip locked
  ), held as (
    update private.identity_checks k set provider_delete_due=now_at+interval '5 minutes' from due
    where k.id=due.id returning k.id,k.session_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('check_id',held.id,'session_id',held.session_id) order by held.id),'[]'::jsonb)
    into rows from held;
  return rows;
end$function$;
alter function internal.claim_identity_check_deletions(integer) owner to postgres;
revoke all on function internal.claim_identity_check_deletions(integer) from public;
grant execute on function internal.claim_identity_check_deletions(integer) to service_role;
