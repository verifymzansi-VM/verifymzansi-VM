-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_business_review_queue(p_tab text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');seen jsonb;result jsonb;
begin
  seen:=internal.get_frontend_seen_queue(p_tab);
  with rows as (
    select x.id,x.kind,x.status,x.business_id,x.created_at,x.updated_at,x.decided_at,d.route,d.registration_number,d.renewal,
      coalesce(p.title,'Business') business_name,coalesce(pr.display_name,'Member') owner_name,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() mine,
      exists(select 1 from private.frontend_cipc_exceptions exc where exc.check_id=x.id and exc.official_file=d.official_file and exc.confirmed_at is null) exception_pending,
      exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id) conflict
    from private.frontend_business_checks x join private.frontend_cipc_reviews d on d.check_id=x.id and d.submitted_at is not null
    join private.posts p on p.id=x.business_id join private.evidence_cases e on e.id=x.id
    left join private.profiles pr on pr.account_id=x.owner_id where x.owner_id<>actor
  ), labelled as (
    select r.*,case when status not in('pending','info_requested') then 'decided'
      when status='info_requested' then 'waiting' when exception_pending then 'exceptions'
      when conflict then 'conflicts' when route='representative' then 'representatives'
      when renewal then 'renewals' else 'review' end tab from rows r
  ), merged as (
    select j.value item from jsonb_array_elements(seen->'rows') j
    union all
    select jsonb_build_object('id',x.id,'kind',x.kind,'route',x.route,'status',x.status,'businessId',x.business_id,
      'businessName',x.business_name,'ownerName',x.owner_name,'registrationNumber',x.registration_number,
      'red',case when x.conflict then 1 else 0 end,'amber',case when x.renewal then 1 else 0 end,
      'createdAt',x.created_at,'updatedAt',x.updated_at,'exceptionPending',x.exception_pending,'conflict',x.conflict,'renewal',x.renewal)
    from labelled x where x.tab=p_tab or (p_tab<>'decided' and x.tab<>'decided' and x.mine)
  )
  select jsonb_build_object('actor_id',actor,
    'counts',(select jsonb_object_agg(k,case when k='decided' then null else (seen->'counts'->>k)::bigint+(select count(*) from labelled where tab=k) end)
      from jsonb_object_keys(seen->'counts') k),
    'rows',coalesce((select jsonb_agg(r.item) from (select item from merged order by
      case when p_tab='decided' then -(extract(epoch from (item->>'updatedAt')::timestamptz)) else -(item->>'red')::integer end,
      (item->>'createdAt')::timestamptz,item->>'id' limit 200)r),'[]'::jsonb)) into result;
  perform internal.staff_actor('queue:view');return result;
end$function$;
alter function internal.get_frontend_business_review_queue(text) owner to postgres;
revoke all on function internal.get_frontend_business_review_queue(text) from public;
grant execute on function internal.get_frontend_business_review_queue(text) to authenticated;
