-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_expired_inbox(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare enquiries integer; notifications integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  delete from private.notifications where id in(select n.id from private.notifications n
    where n.created_at<statement_timestamp()-interval '90 days' order by n.created_at limit p_limit for update skip locked);
  get diagnostics notifications=row_count;
  delete from private.enquiries where id in(select x.id from private.enquiries x
    where x.retain_until<=statement_timestamp() order by x.retain_until limit p_limit for update skip locked);
  get diagnostics enquiries=row_count;
  return jsonb_build_object('enquiries',enquiries,'notifications',notifications);
end;
$function$;
alter function internal.purge_expired_inbox(integer) owner to postgres;
revoke all on function internal.purge_expired_inbox(integer) from public;
grant execute on function internal.purge_expired_inbox(integer) to service_role;
