-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_is_first_purchase(p_payment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A confirmed payment of a (not erased) account, with no payment of the same
  -- account confirmed before it, whatever happened to that one later.
  select coalesce((select p.owner_id is not null and p.completed_at is not null
      and not exists(select 1 from private.payments q where q.owner_id = p.owner_id and q.id <> p.id
        and q.status in ('complete', 'refunded', 'chargeback') and q.completed_at is not null
        and (q.completed_at, q.id) < (p.completed_at, p.id))
    from private.payments p where p.id = p_payment_id), false);
$function$;
alter function internal.payment_is_first_purchase(uuid) owner to postgres;
revoke all on function internal.payment_is_first_purchase(uuid) from public;
