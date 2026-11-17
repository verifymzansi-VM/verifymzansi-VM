-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_support_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('support:view');result jsonb;
begin
  select jsonb_build_object('actor_id',actor,'new',count(*),'oldest_at',min(created_at)) into result
    from private.support_tickets where status='new';
  perform internal.staff_actor('support:view');return result;
end$function$;
alter function internal.get_frontend_support_metrics() owner to postgres;
revoke all on function internal.get_frontend_support_metrics() from public;
grant execute on function internal.get_frontend_support_metrics() to authenticated;
