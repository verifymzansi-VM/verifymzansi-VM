-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_staff_invoice_transfers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; result jsonb;
begin
  actor := internal.staff_actor('payments:view');
  select jsonb_build_object('waiting', (select count(*) from private.invoice_transfers t where t.status = 'awaiting_confirmation'),
      'items', coalesce(jsonb_agg(internal.invoice_transfer_dto(t, actor) order by t.recorded_at, t.id), '[]'::jsonb))
    into result
  from (select * from private.invoice_transfers x where x.status = 'awaiting_confirmation'
    order by x.recorded_at, x.id limit 50) t;
  if internal.staff_actor('payments:view') is distinct from actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  return result;
end;
$function$;
alter function internal.get_staff_invoice_transfers() owner to postgres;
revoke all on function internal.get_staff_invoice_transfers() from public;
grant execute on function internal.get_staff_invoice_transfers() to authenticated;
