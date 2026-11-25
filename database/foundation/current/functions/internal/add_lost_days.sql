-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.add_lost_days(p_email text, p_days integer, p_reason text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('payments:refund');
  v_member uuid;
  v_prior record;
  v_locked uuid[];
  v_current uuid[];
  v_target uuid;
  v_now timestamptz := statement_timestamp();
begin
  if p_request_id is null then
    raise exception 'lost days: a request id is required' using errcode='22023', detail='lost_days_request_invalid';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'lost days: choose 1 to 30 days' using errcode='22023', detail='lost_days_days_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, false), false) then
    raise exception 'lost days: a reason of 5 to 500 characters is required' using errcode='22023',
      detail='lost_days_reason_required';
  end if;
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'lost days: no active member account has this email' using errcode='PT409',
      detail='lost_days_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_member);
  -- One change at a time per member, and never beside a package delivery.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||v_member::text, 707));
  -- A repeated request answers as the first did and adds nothing.
  select count(*) as n, bool_and(e.owner_id is not distinct from v_member) as same_member,
      bool_and(r.days=p_days and r.reason=p_reason) as same_input
    into v_prior
    from private.lost_day_additions r left join private.entitlements e on e.id=r.entitlement_id
    where r.request_id=p_request_id;
  if v_prior.n>0 and not (v_prior.same_member and v_prior.same_input) then
    raise exception 'lost days: this request id was already used for another change' using errcode='PT409',
      detail='lost_days_request_reused';
  end if;
  if v_prior.n=0 then
    -- The running paid grants, locked in id order (as renewal delivery locks a slot's grants).
    select array_agg(l.id order by l.id) into v_locked from (
      select e.id from private.entitlements e
        join private.payments pay on pay.id=e.payment_id and pay.status='complete'
      where e.owner_id=v_member and e.source='retail_paid' and e.status='active' and e.ends_at>v_now
      order by e.id for update of e) l;
    actor := internal.staff_actor('payments:refund'); -- authority after the waits
    select array_agg(e.id order by e.id) into v_current from private.entitlements e
      join private.payments pay on pay.id=e.payment_id and pay.status='complete'
    where e.owner_id=v_member and e.source='retail_paid' and e.status='active' and e.ends_at>v_now;
    if v_current is distinct from v_locked then
      raise exception 'lost days: the member''s slots changed just now; try again' using errcode='PT409',
        detail='lost_days_busy';
    end if;
    if v_locked is null then
      raise exception 'lost days: this member has no running paid slot or package' using errcode='PT409',
        detail='lost_days_nothing_running';
    end if;
    -- At most 30 days in all per grant; beyond that, staff refund instead.
    if exists(select 1 from private.lost_day_additions r where r.entitlement_id=any(v_locked)
        group by r.entitlement_id having sum(r.days)+p_days>30) then
      raise exception 'lost days: at most 30 days in all can be added to a slot; refund instead' using errcode='PT409',
        detail='lost_days_limit';
    end if;
    insert into private.lost_day_additions(request_id, entitlement_id, actor_id, days, starts_before, starts_after,
        ends_before, ends_after, reason)
      select p_request_id, e.id, actor, p_days, e.starts_at,
        case when e.starts_at>v_now then e.starts_at+make_interval(days=>p_days) else e.starts_at end,
        e.ends_at, e.ends_at+make_interval(days=>p_days), p_reason
      from private.entitlements e where e.id=any(v_locked);
    update private.entitlements e set starts_at=r.starts_after, ends_at=r.ends_after
      from private.lost_day_additions r where r.request_id=p_request_id and r.entitlement_id=e.id;
    -- The search end of the posts in these slots follows now.
    for v_target in select distinct coalesce(e.slot_id, e.id) from private.entitlements e where e.id=any(v_locked) loop
      perform internal.refresh_slot_chain_documents(v_target);
    end loop;
    for v_target in select distinct e.package_id from private.entitlements e
        where e.id=any(v_locked) and e.package_id is not null loop
      perform internal.refresh_package_documents(v_target);
    end loop;
  end if;
  return jsonb_build_object('request_id', p_request_id, 'days', p_days, 'repeated', v_prior.n>0,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('kind', g.kind, 'id', g.id, 'slots', g.slots, 'renewals', g.renewals,
          'ends_before', g.ends_before, 'ends_after', g.ends_after) order by g.ends_before, g.id)
      from (
        select case when bool_and(e.package_id is null) then 'individual' else 'package' end as kind,
          coalesce(e.package_id, e.slot_id, e.id) as id,
          case when bool_and(e.package_id is null) then max(e.slot_capacity) else sum(e.slot_capacity) end::integer as slots,
          (count(*) filter (where r.starts_after>r.starts_before))::integer as renewals,
          max(r.ends_before) as ends_before, max(r.ends_after) as ends_after
        from private.lost_day_additions r join private.entitlements e on e.id=r.entitlement_id
        where r.request_id=p_request_id
        group by 2
      ) g), '[]'::jsonb));
end;
$function$;
alter function internal.add_lost_days(text,integer,text,uuid) owner to postgres;
revoke all on function internal.add_lost_days(text,integer,text,uuid) from public;
grant execute on function internal.add_lost_days(text,integer,text,uuid) to authenticated;
