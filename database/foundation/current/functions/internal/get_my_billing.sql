-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_billing()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'payments',coalesce((select jsonb_agg(internal.billing_payment_dto(p) order by p.created_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p),'[]'),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'payment_id',p.id,
      'invoice_number',i.invoice_number,'total_cents',i.total_cents::text,
      'amount_ex_vat_cents',i.amount_ex_vat_cents::text,'vat_cents',i.vat_cents::text,
      'description',i.description,'issued_at',i.issued_at,'payment_status',p.status) order by i.issued_at desc)
      from (select * from private.payments where owner_id=actor order by created_at desc limit 100) p
      join private.invoices i on i.payment_id=p.id),'[]'),
    'entitlements',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'area',e.area,
      'source',e.source,'status',e.status,'slot_capacity',e.slot_capacity,
      'max_photos',e.max_photos,'max_videos',e.max_videos,'addon_capabilities',to_jsonb(e.addon_capabilities),
      'starts_at',e.starts_at,'ends_at',e.ends_at,'used',(select count(*) from private.post_activations a
        where a.entitlement_id=e.id and a.released_at is null)))
      from private.entitlements e where (e.owner_id=actor or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=actor)) and e.status='active'
      and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)),'[]')) into result;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_billing() owner to postgres;
revoke all on function internal.get_my_billing() from public;
grant execute on function internal.get_my_billing() to authenticated;
