-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_lines_renewing(p_payment_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(array_agg(distinct coalesce(t.slot_id, t.id)), '{}'::uuid[]) from private.payment_lines l
    join private.entitlements t on t.id=l.renews_entitlement_id
  where l.payment_id=p_payment_id and l.status='open' and internal.slot_chain_held(t.id);
$function$;
alter function internal.slot_lines_renewing(uuid) owner to postgres;
revoke all on function internal.slot_lines_renewing(uuid) from public;
