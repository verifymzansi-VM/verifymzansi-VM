-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.fulfil_account_deletion(p_request uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('dsar:manage'); result jsonb;
begin
  if p_revision is null then raise exception 'represented privacy request required' using errcode = '22023'; end if;
  result := internal.order_account_erasure(p_request, p_revision, actor);
  perform internal.staff_actor('dsar:manage'); -- authority after any lock wait
  return result;
end;
$function$;
alter function internal.fulfil_account_deletion(uuid,integer) owner to postgres;
revoke all on function internal.fulfil_account_deletion(uuid,integer) from public;
grant execute on function internal.fulfil_account_deletion(uuid,integer) to authenticated;
