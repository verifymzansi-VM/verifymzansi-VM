-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_list_partners()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage');
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'account_id',p.account_id,'code',p.code,
      'status',p.status,'commission_bps',p.commission_bps,'revision',p.revision,
      'referrals',(select count(*) from private.account_acquisitions a where a.partner_id=p.id),
      'pending_cents',(select coalesce(sum(c.amount_cents),0)::text from private.partner_commissions c
        where c.partner_id=p.id and c.status='pending'),
      'approved_cents',(select coalesce(sum(c.amount_cents),0)::text from private.partner_commissions c
        where c.partner_id=p.id and c.status='approved')) order by p.created_at desc),'[]')
    from (select * from private.partners x order by x.created_at desc limit 500) p);
end;
$function$;
alter function internal.staff_list_partners() owner to postgres;
revoke all on function internal.staff_list_partners() from public;
grant execute on function internal.staff_list_partners() to authenticated;
