-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.signup_email_domain_refused(p_email text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select x.domain is null
    or x.domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    or substring(x.domain from '[^.]+$') ~ '^[0-9]+$'
    or substring(x.domain from '[^.]+$') in ('test', 'example', 'invalid', 'localhost', 'local',
      'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'intranet')
    or x.domain in ('example.com', 'example.net', 'example.org')
    or exists (select 1 from private.signup_blocked_domains b
      where x.domain = b.domain or right(x.domain, char_length(b.domain) + 1) = '.' || b.domain)
  from (select substring(lower(btrim(p_email)) from '@([^@]+)$') as domain) x;
$function$;
alter function internal.signup_email_domain_refused(text) owner to postgres;
revoke all on function internal.signup_email_domain_refused(text) from public;
grant execute on function internal.signup_email_domain_refused(text) to supabase_auth_admin;
