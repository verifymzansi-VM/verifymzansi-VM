-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_slots_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); verified text; fingerprint text; counted jsonb; raise_ends timestamptz;
  result jsonb;
begin
  verified:=internal.current_verified_identity(actor);
  fingerprint:=coalesce(verified, internal.individual_slot_identity(actor));
  counted:=internal.individual_slots_counted(fingerprint, actor, null);
  select l.ends_at into raise_ends from private.individual_slot_limits l
    where l.identity_hmac=fingerprint and l.revoked_at is null and l.ends_at>clock_timestamp();
  select jsonb_build_object(
    'slots', coalesce((select jsonb_agg(s.slot order by s.ended, s.ends_at, s.id) from (
        select e.id, e.ends_at, e.ends_at<=statement_timestamp() as ended, jsonb_build_object(
          'id', e.id, 'source', e.source,
          'individual', coalesce(internal.individual_slot_plan(v.plan_code), false),
          'label', coalesce(v.label, pay.snapshot->>'label'),
          'area', e.area, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
          'state', case when e.starts_at>statement_timestamp() then 'upcoming'
            when e.ends_at>statement_timestamp() then 'active' else 'ended' end,
          'places', e.slot_capacity,
          'sponsor', (select o.name from private.organisation_sponsorships sp
              join private.organisations o on o.id=sp.organisation_id where sp.entitlement_id=e.id limit 1),
          -- Renewing: an Individual slot that is still held can be renewed
          -- from 14 days before it ends (renew_opens_at); renewed_until is
          -- the end of its unbroken run of renewed periods.
          'renewable', coalesce(internal.individual_slot_plan(v.plan_code), false) and l.status='open'
            and pay.status='complete' and internal.slot_chain_held(e.id)
            and internal.slot_chain_last_end(e.id)<=clock_timestamp()+internal.slot_renewal_window(),
          'renew_opens_at', case when coalesce(internal.individual_slot_plan(v.plan_code), false) and l.status='open'
              and pay.status='complete' and internal.slot_chain_held(e.id)
            then internal.slot_chain_last_end(e.id)-internal.slot_renewal_window() end,
          'renewed_until', case when internal.slot_chain_end(e.id)>e.ends_at then internal.slot_chain_end(e.id) end,
          'renewals', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'starts_at', n.starts_at,
                'ends_at', n.ends_at) order by n.starts_at, n.id)
              from private.entitlements n where n.slot_id=coalesce(e.slot_id, e.id) and n.status='active'
                and n.starts_at>greatest(e.starts_at, statement_timestamp())), '[]'),
          'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
                'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at) order by x.activated_at, x.id)
              from (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at
                from private.post_activations a join private.posts p on p.id=a.post_id
                where p.owner_id=actor and p.edit_of is null
                  and (a.entitlement_id=e.id
                    -- a post still in the period that just ended, waiting to move to this one
                    or (a.released_at is null and a.entitlement_id in (select c.id from private.entitlements c
                      where c.id<>e.id and (c.id=coalesce(e.slot_id, e.id) or c.slot_id=coalesce(e.slot_id, e.id))
                        and c.ends_at<=statement_timestamp() and c.ends_at>=e.starts_at
                        and e.starts_at<=statement_timestamp())))
                  and (a.released_at is null
                    or (a.entitlement_id=e.id and e.ends_at<=statement_timestamp()
                      and a.release_reason in ('expired','entitlement_ended')
                      and p.status='expired' and p.deletes_at>statement_timestamp()
                      and not exists(select 1 from private.post_activations n where n.post_id=p.id and n.released_at is null)))
                order by p.id, a.activated_at desc) x), '[]')) as slot
        from private.entitlements e
          left join private.payment_lines l on l.id=e.payment_line_id
          left join private.plan_versions v on v.id=l.plan_version_id
          left join private.payments pay on pay.id=e.payment_id
        where e.owner_id=actor and e.status='active' and e.ends_at>statement_timestamp()-interval '3 days'
          -- the current period of each slot, a period that ended in the last
          -- 3 days unless the next one followed on from it, and a renewal
          -- waiting to start when its slot has no current period
          and (e.starts_at<=statement_timestamp() or not exists(select 1 from private.entitlements c
            where (c.id=coalesce(e.slot_id, e.id) or c.slot_id=coalesce(e.slot_id, e.id)) and c.id<>e.id
              and c.status='active' and c.starts_at<=statement_timestamp() and c.ends_at>statement_timestamp()))
          and (e.starts_at<=statement_timestamp() or not exists(select 1 from private.entitlements c
            where c.slot_id=coalesce(e.slot_id, e.id) and c.id<>e.id and c.status='active'
              and c.starts_at>statement_timestamp() and c.starts_at<e.starts_at))
          and not (e.ends_at<=statement_timestamp() and exists(select 1 from private.entitlements n
            where n.slot_id=coalesce(e.slot_id, e.id) and n.id<>e.id and n.status='active'
              and n.starts_at<=e.ends_at and n.ends_at>e.ends_at))
        order by e.ends_at desc limit 200) s), '[]'),
    'individual', jsonb_build_object('verified', verified is not null,
      'held', (counted->>'held')::integer, 'pending', (counted->>'pending')::integer,
      'renewed_ahead', internal.individual_slots_extended(fingerprint, actor, null, null),
      'limit', internal.individual_slot_limit(fingerprint), 'limit_ends_at', raise_ends)) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_slots_v2() owner to postgres;
revoke all on function internal.get_my_slots_v2() from public;
grant execute on function internal.get_my_slots_v2() to authenticated;
