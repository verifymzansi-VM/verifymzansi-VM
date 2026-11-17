-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.expire_waiting_bank_transfers(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare due uuid[]; one uuid; expired integer := 0; with_invoice integer := 0; failed integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'limit 1 to 1000' using errcode='22023';
  end if;
  select coalesce(array_agg(x.id order by x.recorded_at, x.id), '{}') into due
  from (select t.id, t.recorded_at from private.invoice_transfers t
    where t.status = 'awaiting_confirmation'
      and t.recorded_at <= statement_timestamp() - internal.invoice_transfer_expires_after()
    order by t.recorded_at, t.id
    limit p_limit
    for update skip locked) x;
  foreach one in array due loop
    begin
      if internal.expire_invoice_transfer(one) then
        expired := expired + 1;
        if exists(select 1 from private.invoice_transfers t where t.id = one and t.customer_invoice_id is not null) then
          with_invoice := with_invoice + 1;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
    end;
  end loop;
  return jsonb_build_object('expired', expired, 'with_invoice', with_invoice, 'failed', failed);
end;
$function$;
alter function internal.expire_waiting_bank_transfers(integer) owner to postgres;
revoke all on function internal.expire_waiting_bank_transfers(integer) from public;
grant execute on function internal.expire_waiting_bank_transfers(integer) to service_role;
