-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_business_checked(p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.posts p where p.owner_id=p_owner and p.kind='business' and p.status='live'
      and p.edit_of is null)
    or exists(select 1 from private.frontend_business_checks c where c.owner_id=p_owner and c.status='approved'
      and c.revoked_at is null and c.expires_at>clock_timestamp());
$function$;
alter function internal.individual_slot_business_checked(uuid) owner to postgres;
revoke all on function internal.individual_slot_business_checked(uuid) from public;
