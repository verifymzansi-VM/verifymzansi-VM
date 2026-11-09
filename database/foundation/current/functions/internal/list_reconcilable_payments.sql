-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_reconcilable_payments(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_limit not between 1 and 50 then raise exception 'invalid reconciliation limit' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(internal.billing_payment_dto(p)) from
    (select * from private.payments where status in ('pending','failed','expired','cancelled')
      and provider_request_id is not null and created_at>statement_timestamp()-interval '14 days'
      order by reconciliation_checked_at nulls first,created_at limit p_limit) p),'[]');
end;
$function$;
alter function internal.list_reconcilable_payments(integer) owner to postgres;
revoke all on function internal.list_reconcilable_payments(integer) from public;
grant execute on function internal.list_reconcilable_payments(integer) to service_role;
