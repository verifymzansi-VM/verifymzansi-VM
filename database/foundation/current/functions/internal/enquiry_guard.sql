-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.enquiry_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.request_id,new.post_id,new.owner_id,new.buyer_name,new.buyer_email,new.email_confirmed,
      new.buyer_phone,new.message,new.created_at,new.retain_until)
    is distinct from (old.id,old.request_id,old.post_id,old.owner_id,old.buyer_name,old.buyer_email,old.email_confirmed,
      old.buyer_phone,old.message,old.created_at,old.retain_until)
    or (new.sender_account_id is distinct from old.sender_account_id and new.sender_account_id is not null) then
    raise exception 'enquiries are immutable except their status' using errcode='23514'; end if;
  return new;
end;
$function$;
alter function internal.enquiry_guard() owner to postgres;
revoke all on function internal.enquiry_guard() from public;
