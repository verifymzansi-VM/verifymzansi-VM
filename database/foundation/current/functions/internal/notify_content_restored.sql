-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_content_restored()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Staff released a hold and the hidden post is shown again (the member was
  -- told it was hidden by a content_hidden notice).
  if not new.restored or old.restored or new.post_id is null
    or not exists(select 1 from private.posts p where p.id=new.post_id and p.owner_id=new.account_id) then
    return null;
  end if;
  perform internal.notify_account(new.account_id,'content_restored',new.id,new.post_id,null);
  return null;
end;
$function$;
alter function internal.notify_content_restored() owner to postgres;
revoke all on function internal.notify_content_restored() from public;
