-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_identity_check_availability()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); k private.identity_checks; route jsonb;
begin
  select x.* into k from private.identity_checks x where x.owner_id=actor and x.status<>'unavailable'
    order by x.created_at desc,x.id desc limit 1;
  route:=internal.identity_check_route(actor);
  if route->>'reason'='limit' and k.id is not null and k.status='started' and k.expires_at>clock_timestamp() then
    route:=jsonb_build_object('route','automatic','reason',null); end if;
  return route||jsonb_build_object('check',case when k.id is not null then internal.identity_check_summary(k) end);
end$function$;
alter function internal.get_identity_check_availability() owner to postgres;
revoke all on function internal.get_identity_check_availability() from public;
grant execute on function internal.get_identity_check_availability() to authenticated;
