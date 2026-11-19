-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_release_paused(p_owner uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare r record; changed integer := 0; n integer;
begin
  for r in
    select a.post_id, internal.slot_chain_paid_end(x.id) as paid_end
    from private.post_activations a
      join private.entitlements x on x.id = a.entitlement_id
      join private.posts p on p.id = a.post_id
    where a.owner_id = p_owner and a.released_at is null and a.post_id is not null
      and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
      and x.ends_at <= statement_timestamp() and p.status = 'paused' and p.kind <> 'event'
      and coalesce(internal.slot_chain_end(x.id) <= statement_timestamp(), true)
    order by a.post_id
  loop
    continue when r.paid_end is null;
    begin
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category immediate;
      update private.posts p set visible_until = r.paid_end
        where p.id = (select q.id from private.posts q where q.id = r.post_id and q.status = 'paused'
          and q.kind <> 'event' and q.visible_until > r.paid_end for no key update skip locked);
      get diagnostics n = row_count;
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category deferred;
      changed := changed + n;
    exception when others then
      -- Left as it was; the sweep tries again on its next run.
      set constraints private.core_post_detail, private.core_post_price_category,
        private.listing_attributes_category deferred;
    end;
  end loop;
  return changed;
end;
$function$;
alter function internal.slot_package_release_paused(uuid) owner to postgres;
revoke all on function internal.slot_package_release_paused(uuid) from public;
