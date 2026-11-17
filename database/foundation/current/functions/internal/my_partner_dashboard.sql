-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.my_partner_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); p private.partners;
begin
  select * into p from private.partners x where x.account_id=actor;
  if not found then return null; end if;
  return jsonb_build_object('code',p.code,'status',p.status,'rate_bps',coalesce(p.commission_bps,2000),
    'referrals',(select count(*) from private.account_acquisitions a where a.partner_id=p.id),
    'paying_referrals',(select count(distinct c.referred_account_id) from private.partner_commissions c
      where c.partner_id=p.id and c.status<>'reversed'),
    'totals',(select coalesce(jsonb_object_agg(t.status,t.total::text),'{}') from (select c.status,sum(c.amount_cents) total
      from private.partner_commissions c where c.partner_id=p.id group by c.status) t),
    'recent',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount_cents',c.amount_cents::text,
        'base_cents',c.base_cents::text,'status',c.status,'created_at',c.created_at,'eligible_at',c.eligible_at,
        'paid_at',c.paid_at) order by c.created_at desc,c.id desc),'[]')
      from (select * from private.partner_commissions x where x.partner_id=p.id
        order by x.created_at desc,x.id desc limit 50) c));
end;
$function$;
alter function internal.my_partner_dashboard() owner to postgres;
revoke all on function internal.my_partner_dashboard() from public;
grant execute on function internal.my_partner_dashboard() to authenticated;
