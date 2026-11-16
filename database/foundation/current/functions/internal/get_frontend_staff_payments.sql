-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_payments(p_page integer, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid;result jsonb;total bigint;
begin
  actor:=internal.staff_actor('payments:view');
  if p_page is null or p_page not between 1 and 100000 or (p_status is not null and p_status not in(
    'pending','processing','complete','failed','cancelled','expired','refunded','chargeback'))
    then raise exception 'valid payment filter required' using errcode='22023';end if;
  select count(*) into total from private.payments p where p_status is null or p.status=p_status;
  select jsonb_build_object('total',total,'page',p_page,'items',coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'user_id',p.owner_id,'status',p.status,'amount_cents',p.amount_cents,
    'created_at',p.created_at,'area',coalesce(p.snapshot->>'area',p.snapshot->>'target_area','all'),
    'description',coalesce(p.snapshot->>'label',initcap(p.snapshot->>'addon')||' add-on','Payment'))
    order by p.created_at desc,p.id desc),'[]'::jsonb))
    into result from (select * from private.payments x where p_status is null or x.status=p_status
      order by x.created_at desc,x.id desc limit 50 offset (p_page-1)*50)p;
  if internal.staff_actor('payments:view') is distinct from actor
    then raise exception 'staff actor changed' using errcode='42501';end if;
  return result;
end$function$;
alter function internal.get_frontend_staff_payments(integer,text) owner to postgres;
revoke all on function internal.get_frontend_staff_payments(integer,text) from public;
