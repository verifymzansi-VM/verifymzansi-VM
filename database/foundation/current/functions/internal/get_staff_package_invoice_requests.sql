-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_package_invoice_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('payments:view'); result jsonb;
begin
  select jsonb_build_object('items', coalesce(jsonb_agg(internal.package_invoice_request_dto(r, actor)
      order by r.requested_at, r.id), '[]'::jsonb),
    'open', (select count(*) from private.package_invoice_requests x where x.status in ('requested', 'awaiting_approval')),
    'approval_above_cents', internal.package_invoice_approval_above_cents())
    into result
  from (select * from private.package_invoice_requests x where x.status in ('requested', 'awaiting_approval')
      and x.account_id is not null
    order by x.requested_at, x.id limit 100) r;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_package_invoice_requests() owner to postgres;
revoke all on function internal.get_staff_package_invoice_requests() from public;
grant execute on function internal.get_staff_package_invoice_requests() to authenticated;
