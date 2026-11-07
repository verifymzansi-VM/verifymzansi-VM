-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.signal_owner_inbox(p_owner uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute 'select realtime.send($1,$2,$3,true)'
      using jsonb_build_object('kind','inbox'),'inbox_changed','owner:'||p_owner::text;
  end if;
end;
$function$;
alter function internal.signal_owner_inbox(uuid) owner to postgres;
revoke all on function internal.signal_owner_inbox(uuid) from public;
