-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_check_consent_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.consent_version is distinct from internal.identity_check_consent_version() or new.consented_at is null then
    raise exception 'identity check consent required' using errcode='PT409',detail='identity_check_consent_required';
  end if;
  return new;
end$function$;
alter function internal.identity_check_consent_required() owner to postgres;
revoke all on function internal.identity_check_consent_required() from public;
