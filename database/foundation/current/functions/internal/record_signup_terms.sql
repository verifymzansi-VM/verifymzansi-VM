-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_signup_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare how text;
begin
  if new.is_anonymous then return new; end if;
  if new.raw_app_meta_data ->> 'provider' = 'google' then how:='google';
  elsif new.raw_user_meta_data -> 'terms_accepted' = 'true'::jsonb then how:='email_form';
  else return new;
  end if;
  insert into private.signup_terms_acceptances (account_id, version, document_hash, method)
    select new.id, v.version, v.document_hash, how
    from private.posting_terms_current c join private.posting_terms_versions v on v.version = c.version
    where c.singleton
    on conflict (account_id) do nothing;
  return new;
end;
$function$;
alter function internal.record_signup_terms() owner to postgres;
revoke all on function internal.record_signup_terms() from public;
