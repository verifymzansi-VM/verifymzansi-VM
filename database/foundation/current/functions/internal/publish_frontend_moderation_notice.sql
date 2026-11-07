-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.publish_frontend_moderation_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare owner_id uuid;notice text;
begin
  case tg_table_name
    when 'frontend_content_holds' then owner_id:=new.account_id;notice:='content_hidden';
    when 'frontend_account_restrictions' then owner_id:=new.account_id;notice:=case new.kind when 'ban' then 'account_banned' else 'account_suspended' end;
    when 'frontend_appeals' then owner_id:=new.appellant_id;notice:='appeal_decided';
    else raise exception 'unknown moderation notice source';
  end case;
  insert into private.notifications(account_id,kind,subject_id) values(owner_id,notice,new.id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(notice,new.id,owner_id,notice||':'||new.id)
    on conflict(dedupe_key) do nothing;
  return new;
end$function$;
alter function internal.publish_frontend_moderation_notice() owner to postgres;
revoke all on function internal.publish_frontend_moderation_notice() from public;
