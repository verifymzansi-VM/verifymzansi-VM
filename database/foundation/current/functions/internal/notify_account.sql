-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_account(p_account uuid, p_kind text, p_subject uuid, p_post uuid, p_organisation uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  insert into private.notifications(account_id,kind,subject_id,post_id,organisation_id)
    values(p_account,p_kind,p_subject,p_post,p_organisation);
  perform internal.signal_owner_inbox(p_account);
end;
$function$;
alter function internal.notify_account(uuid,text,uuid,uuid,uuid) owner to postgres;
revoke all on function internal.notify_account(uuid,text,uuid,uuid,uuid) from public;
