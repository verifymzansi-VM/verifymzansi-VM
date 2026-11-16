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
      and x.package_id is null and x.source = 'retail_paid' and x.status = 'active'
      and x.ends_at <= statement_timestamp()
      and coalesce(internal.slot_chain_end(x.id) <= statement_timestamp(), true)
  ), locked as (
    select s.post_id, r.paid_end from private.post_search_documents s join r on r.post_id = s.post_id
    where s.kind <> 'event' and r.paid_end is not null and s.visible_until > statement_timestamp()
    for update of s skip locked
  )
  update private.post_search_documents s set visible_until = l.paid_end from locked l
  where s.post_id = l.post_id;
  get diagnostics changed = row_count;
  return changed;
end;
$function$;
alter function internal.slot_package_release_dates(uuid) owner to postgres;
revoke all on function internal.slot_package_release_dates(uuid) from public;
