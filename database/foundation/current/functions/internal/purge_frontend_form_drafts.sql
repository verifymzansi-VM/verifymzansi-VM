-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_frontend_form_drafts(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then raise exception 'bounded draft cleanup required' using errcode='22023';end if;
  with due as (select d.owner_id,d.flow from private.frontend_form_drafts d
    where d.expires_at<=statement_timestamp() order by d.expires_at,d.owner_id,d.flow limit p_limit for update skip locked)
  delete from private.frontend_form_drafts d using due where d.owner_id=due.owner_id and d.flow=due.flow;
  get diagnostics deleted=row_count;
  return deleted;
end$function$;
alter function internal.purge_frontend_form_drafts(integer) owner to postgres;
revoke all on function internal.purge_frontend_form_drafts(integer) from public;
grant execute on function internal.purge_frontend_form_drafts(integer) to service_role;
