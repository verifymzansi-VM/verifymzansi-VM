-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.issue_slot_line_entitlements(p_payment_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments; snap jsonb; line private.payment_lines; target private.entitlements;
  tail private.entitlements; chain uuid; starts timestamptz; made integer := 0; pkg uuid; add_end timestamptz;
begin
  select * into pay from private.payments p where p.id=p_payment_id;
  snap := pay.snapshot;
  for line in select * from private.payment_lines l where l.payment_id=pay.id and l.status='open' order by l.line_number loop
    starts := statement_timestamp();
    chain := null;
    tail := null;
    pkg := null;
    add_end := null;
    if snap->>'category' = 'slot_package_add' then
      -- Slots added part-way (P4b): a further grant of the buyer's running
      -- package holding every added slot, from payment to the package's end.
      pkg := (snap->>'package_id')::uuid;
      if line.slot_count is distinct from (snap->>'slot_capacity')::integer
          or not exists(select 1 from private.plan_versions v where v.id=line.plan_version_id
            and internal.slot_package_plan(v.plan_code))
          or not exists(select 1 from private.slot_packages k where k.id=pkg and k.owner_id=pay.owner_id) then
        raise exception 'an added-slots line holds the slots it was sold with, for the buyer''s package' using errcode='23514';
      end if;
      select max(e.ends_at) into add_end from private.entitlements e
        where e.package_id=pkg and e.owner_id=pay.owner_id and e.status='active'
          and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp();
      if add_end is null then
        raise exception 'the package these slots were added to has ended' using errcode='PT409', detail='package_ended';
      end if;
    elsif exists(select 1 from private.plan_versions v where v.id=line.plan_version_id
        and internal.slot_package_plan(v.plan_code)) then
      -- A Multi-listing package (20261114154823): its one line holds every
      -- slot it was sold with and opens the package; its grant carries them
      -- all (and 4 posts going live per slot per 30 days).
      if line.slot_count is distinct from (snap->>'slot_capacity')::integer then
        raise exception 'a package line holds the slots it was sold with' using errcode='23514';
      end if;
      insert into private.slot_packages (owner_id, term_days, slot_count)
        values (pay.owner_id, (snap->>'duration_days')::integer, line.slot_count)
        returning id into pkg;
    elsif line.renews_entitlement_id is not null then
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
      renews_entitlement_id, slot_id, package_id)
    values (pay.owner_id, 'retail_paid', snap->>'area', pay.id, line.id, (snap->>'slot_capacity')::integer,
      (snap->>'activations_per_period')::integer, (snap->>'activation_period_days')::integer,
      (snap->>'max_photos')::integer, (snap->>'max_videos')::integer, starts,
      coalesce(add_end, starts + make_interval(days => (snap->>'duration_days')::integer)),
      array(select jsonb_array_elements_text(coalesce(snap->'addon_capabilities','[]'::jsonb))),
      case when chain is not null then coalesce(tail.id, target.id) end, chain, pkg);
    made := made + 1;
    if chain is not null then
      perform internal.refresh_slot_chain_documents(chain);
    end if;
    -- A package touches no post here (no post check may stop a payment being
    -- recorded): the minute sweep moves the search documents of the posts it
    -- takes (internal.refresh_package_documents).
  end loop;
  return made;
end;
$function$;
alter function internal.issue_slot_line_entitlements(uuid) owner to postgres;
revoke all on function internal.issue_slot_line_entitlements(uuid) from public;
