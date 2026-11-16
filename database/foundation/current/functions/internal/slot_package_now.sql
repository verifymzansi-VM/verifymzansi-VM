-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_now(p_owner uuid)
 RETURNS TABLE(package_id uuid, places integer, new_posts_limit integer, starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_column
begin
  return query
    select e.package_id, sum(e.slot_capacity)::integer, sum(e.activations_per_period)::integer,
      min(e.starts_at), max(e.ends_at)
    from private.entitlements e
    where e.owner_id = p_owner and e.package_id is not null and e.status = 'active'
      and e.starts_at <= statement_timestamp() and e.ends_at > statement_timestamp()
      and exists(select 1 from private.payments pay where pay.id = e.payment_id and pay.owner_id = e.owner_id
        and pay.status = 'complete')
      -- the account can use it (checked once, not per grant)
      and exists(select 1 from private.current_account_access u where u.id = p_owner)
    group by e.package_id
    order by max(e.ends_at) desc, e.package_id
    limit 1;
end;
$function$;
alter function internal.slot_package_now(uuid) owner to postgres;
revoke all on function internal.slot_package_now(uuid) from public;
