-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.profile_bio_valid(p_bio text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_bio is not null and char_length(p_bio) between 1 and 300
    and p_bio is nfc normalized and p_bio=btrim(p_bio,E' \n')
    and p_bio !~ '[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]';
$function$;
alter function internal.profile_bio_valid(text) owner to postgres;
revoke all on function internal.profile_bio_valid(text) from public;
