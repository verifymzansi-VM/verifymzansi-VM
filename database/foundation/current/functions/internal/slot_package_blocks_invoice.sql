-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_blocks_invoice(p_identity text, p_owner uuid, p_issued_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.entitlements e join private.slot_packages k on k.id = e.package_id
    where e.owner_id in (select internal.individual_slot_owners(p_identity, p_owner))
      and e.package_id is not null and e.status = 'active' and e.starts_at <= statement_timestamp()
      and e.ends_at > statement_timestamp() + interval '7 days'
      and (p_issued_at is null or k.created_at <= p_issued_at));
$function$;
alter function internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_package_blocks_invoice(text,uuid,timestamp with time zone) from public;
