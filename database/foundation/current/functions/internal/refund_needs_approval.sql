-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.refund_needs_approval(p_kind text, p_refunded_before bigint, p_amount bigint)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select (p_kind = 'refunded' or internal.chargebacks_need_approval())
    and coalesce(p_refunded_before, 0) + p_amount > 100000;
$function$;
alter function internal.refund_needs_approval(text,bigint,bigint) owner to postgres;
revoke all on function internal.refund_needs_approval(text,bigint,bigint) from public;
