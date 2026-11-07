-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.core_detail_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare ids uuid[]; post uuid; post_kind text; children integer;
begin
  if tg_table_name='posts' then
    ids:=case when tg_op='DELETE' then array[old.id] when tg_op='INSERT' then array[new.id] else array[old.id,new.id] end;
  else
    ids:=case when tg_op='DELETE' then array[old.post_id] when tg_op='INSERT' then array[new.post_id] else array[old.post_id,new.post_id] end;
  end if;
  foreach post in array ids loop
    select p.kind into post_kind from private.posts p where p.id=post for update;
    if not found then continue; end if; -- A deleted parent with cascaded details is valid.
    select (select count(*) from private.listing_details d where d.post_id=post)+
      (select count(*) from private.business_details d where d.post_id=post)+
      (select count(*) from private.event_details d where d.post_id=post) into children;
    if children<>1 then raise exception 'exactly one matching detail required' using errcode='23514'; end if;
  end loop;
  return null;
end;
$function$;
alter function internal.core_detail_guard() owner to postgres;
revoke all on function internal.core_detail_guard() from public;
