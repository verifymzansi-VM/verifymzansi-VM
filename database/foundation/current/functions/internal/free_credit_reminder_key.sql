-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.free_credit_reminder_key(p_entitlement uuid, p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'free_credit_reminder:'||g.id||':'||floor(extract(epoch from g.ends_at))::bigint
  from private.entitlements g
  where g.id=p_entitlement and g.owner_id=p_owner and g.source='free_credit' and g.status='active'
    and g.ends_at>clock_timestamp() and g.ends_at<=clock_timestamp()+interval '3 days'
    and exists(select 1 from private.current_account_access a where a.id=g.owner_id);
$function$;
alter function internal.free_credit_reminder_key(uuid,uuid) owner to postgres;
revoke all on function internal.free_credit_reminder_key(uuid,uuid) from public;
