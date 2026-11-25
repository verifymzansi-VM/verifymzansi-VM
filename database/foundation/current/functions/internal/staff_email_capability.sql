-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_email_capability(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case p_kind when 'staff_privacy_request' then 'dsar:manage' when 'staff_appeal' then 'appeal:decide'
    when 'staff_report' then 'report:resolve' end;
$function$;
alter function internal.staff_email_capability(text) owner to postgres;
revoke all on function internal.staff_email_capability(text) from public;
