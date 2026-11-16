-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_payment_limits()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  perform internal.price_draft_actor(); -- a signed-in account with current access and a live session
  return jsonb_build_object('online_max_cents', internal.online_payment_max_cents());
end;
$function$;
alter function internal.get_payment_limits() owner to postgres;
revoke all on function internal.get_payment_limits() from public;
grant execute on function internal.get_payment_limits() to authenticated;
