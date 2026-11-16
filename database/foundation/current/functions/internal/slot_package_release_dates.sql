-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_release_dates(p_owner uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  with r as (
    select a.post_id, internal.slot_chain_paid_end(x.id) as paid_end
    from private.post_activations a join private.entitlements x on x.id = a.entitlement_id
    where a.owner_id = p_owner and a.released_at is null and a.post_id is not null
      and x.package_id is null and x.status = 'active' and x.ends_at <= statement_timestamp()
      and coalesce(internal.slot_chain_end(x.id) <= statement_timestamp(), true)
  ), docs as (
    update private.post_search_documents s set visible_until = r.paid_end from r
    where s.post_id = r.post_id and s.kind <> 'event' and r.paid_end is not null
      and s.visible_until > statement_timestamp()
    returning s.post_id
  )
  update private.posts p set visible_until = r.paid_end from r
  where p.id = r.post_id and p.kind <> 'event' and r.paid_end is not null
    and p.visible_until > statement_timestamp();
  get diagnostics changed = row_count;
  return changed;
end;
$function$;
alter function internal.slot_package_release_dates(uuid) owner to postgres;
revoke all on function internal.slot_package_release_dates(uuid) from public;
