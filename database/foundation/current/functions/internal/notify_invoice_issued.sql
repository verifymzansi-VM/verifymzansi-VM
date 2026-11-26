-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.notify_invoice_issued()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Staff issue an invoice to a member's account: the member is asked to pay it.
  if new.account_id is null or new.status<>'issued' then return null; end if;
  perform internal.notify_account(new.account_id,'invoice_issued',new.id,null,null);
  -- And emailed, with a link to pay it without signing in (20261126053701).
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('invoice_issued',new.id,new.account_id,'invoice_issued:'||new.id);
  return null;
end;
$function$;
alter function internal.notify_invoice_issued() owner to postgres;
revoke all on function internal.notify_invoice_issued() from public;
