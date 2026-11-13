-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_slots()
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
          'state', case when e.ends_at>statement_timestamp() then 'active' else 'ended' end,
          'places', e.slot_capacity,
          'sponsor', (select o.name from private.organisation_sponsorships sp
              join private.organisations o on o.id=sp.organisation_id where sp.entitlement_id=e.id limit 1),
          'posts', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'area', x.area,
                'title', x.title, 'status', x.status, 'deletes_at', x.deletes_at) order by x.activated_at, x.id)
              from (select distinct on (p.id) p.id, p.kind, p.area, p.title, p.status, p.deletes_at, a.activated_at
                from private.post_activations a join private.posts p on p.id=a.post_id
                where a.entitlement_id=e.id and p.owner_id=actor and p.edit_of is null
                  and (a.released_at is null
                    or (e.ends_at<=statement_timestamp() and a.release_reason in ('expired','entitlement_ended')
                      and p.status='expired' and p.deletes_at>statement_timestamp()
                      and not exists(select 1 from private.post_activations n where n.post_id=p.id and n.released_at is null)))
                order by p.id, a.activated_at desc) x), '[]')) as slot
        from private.entitlements e
          left join private.payment_lines l on l.id=e.payment_line_id
          left join private.plan_versions v on v.id=l.plan_version_id
          left join private.payments pay on pay.id=e.payment_id
        where e.owner_id=actor and e.status='active' and e.starts_at<=statement_timestamp()
          and e.ends_at>statement_timestamp()-interval '3 days'
        order by e.ends_at desc limit 200) s), '[]'),
    'individual', jsonb_build_object('verified', verified is not null,
      'held', (counted->>'held')::integer, 'pending', (counted->>'pending')::integer,
      'limit', internal.individual_slot_limit(fingerprint), 'limit_ends_at', raise_ends)) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_slots() owner to postgres;
revoke all on function internal.get_my_slots() from public;
grant execute on function internal.get_my_slots() to authenticated;
