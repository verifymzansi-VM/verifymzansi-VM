-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_frontend_business_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare x private.frontend_business_checks;event_id uuid:=gen_random_uuid();
begin
  if tg_table_name='frontend_business_check_messages' then
    if new.author_role<>'staff' then return new;end if;
    select * into x from private.frontend_business_checks where id=new.check_id and status in('pending','info_requested');
    if not found then return new;end if;
  else
    x:=new;
    if not ((new.status is distinct from old.status and (new.status in('approved','rejected') or new.revoked_at is not null))
      or new.scheduled_for is distinct from old.scheduled_for) then return new;end if;
  end if;
  insert into private.notifications(account_id,kind,subject_id,post_id) values(x.owner_id,'business_check_update',event_id,x.business_id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('business_check_update',event_id,x.owner_id,'business_check_update:'||event_id);
  return new;
end$function$;
alter function internal.notify_frontend_business_check() owner to postgres;
revoke all on function internal.notify_frontend_business_check() from public;
