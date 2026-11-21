-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.privacy_notice_deliverable(r private.privacy_requests)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select r.minimised_at is null -- a minimised request has no address left
    -- An erased account's request goes to the address stored with it.
    and (r.identity_check='manual' or exists(select 1 from private.account_erasure_requests l where l.request_id=r.id)
      or exists(select 1 from auth.users u where u.id=r.subject_user_id and u.email_confirmed_at is not null
        and not u.is_anonymous and u.deleted_at is null and lower(u.email)=lower(r.requester_email)))
$function$;
alter function internal.privacy_notice_deliverable(private.privacy_requests) owner to postgres;
revoke all on function internal.privacy_notice_deliverable(private.privacy_requests) from public;
