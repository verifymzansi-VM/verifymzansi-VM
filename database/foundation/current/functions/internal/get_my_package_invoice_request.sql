-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_package_invoice_request()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); latest private.package_invoice_requests;
begin
  select * into latest from private.package_invoice_requests r where r.account_id = actor
    order by r.requested_at desc, r.id desc limit 1;
  perform internal.price_draft_actor();
  return jsonb_build_object('request', case when latest.id is null then null
    else internal.package_invoice_request_dto(latest, null) end);
end;
$function$;
alter function internal.get_my_package_invoice_request() owner to postgres;
revoke all on function internal.get_my_package_invoice_request() from public;
grant execute on function internal.get_my_package_invoice_request() to authenticated;
