-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.valid_ozow_refund_fact(p_fact jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(jsonb_typeof(p_fact) = 'object'
    and p_fact->>'refund_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and p_fact->>'transaction_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and jsonb_typeof(p_fact->'amount_cents') = 'number' and p_fact->>'amount_cents' ~ '^[1-9][0-9]{0,11}$'
    and p_fact->>'status' in ('Pending', 'Submitted', 'Complete', 'Failed', 'Cancelled', 'Returned', 'Invalid',
      'PendingInvestigation', 'Error')
    and (p_fact->'requested_at' is null or jsonb_typeof(p_fact->'requested_at') = 'null'
      or p_fact->>'requested_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$')
    and (p_fact->'completed_at' is null or jsonb_typeof(p_fact->'completed_at') = 'null'
      or p_fact->>'completed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$'), false);
$function$;
alter function internal.valid_ozow_refund_fact(jsonb) owner to postgres;
revoke all on function internal.valid_ozow_refund_fact(jsonb) from public;
