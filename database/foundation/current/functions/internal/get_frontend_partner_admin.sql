-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_partner_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage');result jsonb;
begin
  select jsonb_build_object('actor_id',actor,'default_rate_bps',2000,
    'partners',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select p.id,p.account_id,p.code,p.status,p.commission_bps,p.created_at,pr.display_name,
        (select count(*) from private.account_acquisitions a where a.partner_id=p.id) referrals
      from private.partners p left join private.profiles pr on pr.account_id=p.account_id order by p.created_at desc,p.id desc limit 500)x),'[]'::jsonb),
    'commissions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select c.id,c.partner_id,p.code partner_code,c.base_cents::text,c.amount_cents::text,c.rate_bps,c.status,c.eligible_at,c.created_at,pay.status payment_status
      from private.partner_commissions c join private.partners p on p.id=c.partner_id
      join private.payments pay on pay.id=c.payment_id order by c.created_at desc,c.id desc limit 200)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('partner:manage');return result;
end$function$;
alter function internal.get_frontend_partner_admin() owner to postgres;
revoke all on function internal.get_frontend_partner_admin() from public;
grant execute on function internal.get_frontend_partner_admin() to authenticated;
