-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.frontend_report_record_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op='INSERT' then
    select p.area into new.frontend_area from private.posts p where p.id=new.post_id;
    if new.revision<>1 then raise exception 'initial report revision required' using errcode='22023';end if;
  else
    if new.revision<>old.revision or new.frontend_area is distinct from old.frontend_area then raise exception 'report metadata is derived' using errcode='22023';end if;
    if to_jsonb(new)-'revision' is distinct from to_jsonb(old)-'revision' then
      if old.revision=2147483647 then raise exception 'report revision exhausted' using errcode='PT409';end if;
      new.revision:=old.revision+1;
    end if;
  end if;
  return new;
end$function$;
alter function internal.frontend_report_record_guard() owner to postgres;
revoke all on function internal.frontend_report_record_guard() from public;
