-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_lines_adding(p_payment_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.payment_lines l
  where l.payment_id=p_payment_id and l.status='open'
    and (l.renews_entitlement_id is null or not internal.slot_chain_held(l.renews_entitlement_id));
$function$;
alter function internal.slot_lines_adding(uuid) owner to postgres;
revoke all on function internal.slot_lines_adding(uuid) from public;
