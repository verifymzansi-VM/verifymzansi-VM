-- Reviewed rollback for updates/20261125213005_release_one_phone_number.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It drops the three release
-- commands and their helpers, puts back the earlier body of
-- internal.phone_number_banned byte for byte and drops the release columns
-- with their indexes and rules. Numbers released meanwhile are blocked again
-- while their ban runs (their release marks are dropped with the columns); a
-- phone proof the approval revoked stays revoked.
-- It refuses (55000) unless internal.phone_number_banned has the update's body.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.phone_number_banned(text)');
  if body is null or body not in('07c5a85df974869e998f05d22ba00240') then
    raise exception 'rollback precondition: the release one phone number update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

drop function if exists api.get_phone_number_releases();
drop function if exists internal.get_phone_number_releases();
drop function if exists api.review_phone_number_release(text,boolean);
drop function if exists internal.review_phone_number_release(text,boolean);
drop function if exists api.propose_phone_number_release(text,text);
drop function if exists internal.propose_phone_number_release(text,text);
drop function if exists internal.phone_release_conflict(uuid,text);

CREATE OR REPLACE FUNCTION internal.phone_number_banned(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.banned_phone_numbers n
    join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned(text) owner to postgres;
revoke all on function internal.phone_number_banned(text) from public,anon,authenticated,service_role;

drop index if exists private.banned_phone_numbers_release_proposed_by_idx;
drop index if exists private.banned_phone_numbers_released_by_idx;
alter table private.banned_phone_numbers
  drop constraint if exists banned_phone_numbers_release_check,
  drop constraint if exists banned_phone_numbers_release_request_check,
  drop constraint if exists banned_phone_numbers_release_reason_check,
  drop constraint if exists banned_phone_numbers_released_by_fkey,
  drop constraint if exists banned_phone_numbers_release_proposed_by_fkey,
  drop column if exists released_at,
  drop column if exists released_by,
  drop column if exists release_proposed_at,
  drop column if exists release_proposed_by,
  drop column if exists release_reason;

notify pgrst,'reload schema';
commit;
