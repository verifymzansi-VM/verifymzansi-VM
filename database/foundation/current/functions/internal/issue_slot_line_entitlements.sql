-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    if line.renews_entitlement_id is not null then
      select * into target from private.entitlements e where e.id=line.renews_entitlement_id;
      if target.owner_id is distinct from pay.owner_id then
        raise exception 'a renewal must renew a slot of the account that paid' using errcode='23514';
      end if;
      chain := coalesce(target.slot_id, target.id);
      perform 1 from private.entitlements e where e.id=chain or e.slot_id=chain order by e.id for update;
      select * into tail from private.entitlements e where (e.id=chain or e.slot_id=chain) and e.status='active'
        order by e.ends_at desc, e.id desc limit 1;
      if tail.id is not null then
        starts := greatest(tail.ends_at, statement_timestamp());
      end if;
    end if;
    insert into private.entitlements (owner_id, source, area, payment_id, payment_line_id, slot_capacity,
      activations_per_period, activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities,
      renews_entitlement_id, slot_id)
    values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, line.id, (snap->>'slot_capacity')::integer,
      (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
      (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, starts,
      starts + make_interval(days => (snap->>'duration_days')::integer),
      array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))),
      case when chain is not null then coalesce(tail.id, target.id) end, chain);
    made := made + 1;
    if chain is not null then
      perform internal.refresh_slot_chain_documents(chain);
    end if;
  end loop;
  return made;
end;
$function$;
alter function internal.issue_slot_line_entitlements(uuid) owner to postgres;
revoke all on function internal.issue_slot_line_entitlements(uuid) from public;
