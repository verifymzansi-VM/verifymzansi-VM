-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.enquiry_email_valid(p_email text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_email is not null and char_length(p_email)<=254 and p_email=lower(p_email)
    and p_email ~ '^[a-z0-9._%+-]{1,64}@[a-z0-9-]+([.][a-z0-9-]+)*[.][a-z]{2,63}$';
$function$;
alter function internal.enquiry_email_valid(text) owner to postgres;
revoke all on function internal.enquiry_email_valid(text) from public;
