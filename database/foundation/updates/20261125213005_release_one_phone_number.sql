-- Release one blocked phone number (launch checklist item 21).
--
-- Since 20261117064820_ban_blocks_phone_numbers.sql a ban also blocks every
-- phone number the banned person verified (private.banned_phone_numbers, kept
-- as long as the ban). A number is freed only when the whole ban is lifted or
-- after its 5 years. Networks re-issue numbers, and a number can be blocked by
-- mistake, so staff need to free one number while the ID ban stays.
--
-- From this update:
-- 1. private.banned_phone_numbers gets release columns: release_reason,
--    release_proposed_by, release_proposed_at (a waiting request, 7 days) and
--    released_by, released_at (the approval). A released number is marked,
--    never deleted: the trigger ban_identity_phone_numbers re-runs its
--    "insert ... on conflict do nothing" whenever the ban row changes (a
--    replacement decision, a later ban of the same person), which keeps the
--    mark, so the number is not blocked again. The marks go with the ban row
--    (lifted, or purged after 5 years) like the numbers themselves.
-- 2. internal.phone_number_banned (full body) ignores released rows.
-- 3. Three staff commands, capability account:restore (admin and governor,
--    an authenticator code from the last 15 minutes; the same as lifting a
--    whole ban):
--    - api.propose_phone_number_release(p_phone, p_reason): asks to free a
--      number a running ban blocks now (otherwise PT404 phone_not_blocked).
--      One waiting request per number (PT409 phone_release_pending); the
--      same staff member sending the same reason again gets the waiting
--      request back (reused).
--    - api.review_phone_number_release(p_phone, p_approve): approval by a
--      different staff member only (42501 phone_release_same_staff), while the
--      request is under 7 days old and its proposer still holds the
--      capability (PT409 phone_release_changed). It marks every ban row of
--      that number released and revokes the active phone proof of that number
--      still held by an account of the banned person (only that one), so
--      whoever holds the number now can verify it. Rejection (by any staff
--      member with the capability, the proposer included) clears the request.
--    - api.get_phone_number_releases(): the waiting requests and the latest 50
--      releases, with the full numbers. Only numbers someone asked to release
--      are listed, never the whole blocked list.
--    Nobody may propose or decide a release of a number they verified
--    themselves, or of a number blocked by their own ban (42501
--    phone_release_conflict).
--
-- The member is told nothing: no SMS, email or notice. The banned person's ID
-- ban is unchanged. Whoever holds the number now can verify it normally.
--
-- Expand only: three new API commands, five new columns, one replaced body.
-- ORDER: apply first, then merge (the Deploy gate probes every command in the
-- runtime manifest).
-- It refuses with 55000 unless internal.phone_number_banned has its reviewed
-- body (or this update's).
-- Read-only preflight: ../preflight/20261125213005_release_one_phone_number.check.sql.
-- Rollback: ../rollback/20261125213005_release_one_phone_number.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.phone_number_banned(text)');
  if body is null or body not in('ddfab60ae9bad5a5b3f8fb3c5200ade3','07c5a85df974869e998f05d22ba00240') then
    raise exception 'release one phone number precondition: internal.phone_number_banned(text) is not a reviewed body (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

alter table private.banned_phone_numbers
  add column if not exists release_reason text,
  add column if not exists release_proposed_by uuid,
  add column if not exists release_proposed_at timestamptz,
  add column if not exists released_by uuid,
  add column if not exists released_at timestamptz;
alter table private.banned_phone_numbers
  drop constraint if exists banned_phone_numbers_release_proposed_by_fkey,
  add constraint banned_phone_numbers_release_proposed_by_fkey foreign key(release_proposed_by) references auth.users(id) on delete set null,
  drop constraint if exists banned_phone_numbers_released_by_fkey,
  add constraint banned_phone_numbers_released_by_fkey foreign key(released_by) references auth.users(id) on delete set null,
  drop constraint if exists banned_phone_numbers_release_reason_check,
  add constraint banned_phone_numbers_release_reason_check check(release_reason is null or length(release_reason) between 10 and 500),
  drop constraint if exists banned_phone_numbers_release_request_check,
  add constraint banned_phone_numbers_release_request_check check((release_proposed_at is null)=(release_reason is null)),
  drop constraint if exists banned_phone_numbers_release_check,
  add constraint banned_phone_numbers_release_check check(released_at is null or release_proposed_at is not null);
create index if not exists banned_phone_numbers_release_proposed_by_idx on private.banned_phone_numbers(release_proposed_by) where release_proposed_by is not null;
create index if not exists banned_phone_numbers_released_by_idx on private.banned_phone_numbers(released_by) where released_by is not null;

CREATE OR REPLACE FUNCTION internal.phone_number_banned(p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.banned_phone_numbers n
    join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned(text) owner to postgres;
revoke all on function internal.phone_number_banned(text) from public,anon,authenticated,service_role;

-- Whether staff member p_actor verified p_phone themselves, or p_phone is
-- blocked by a ban of p_actor's own identity: they may not release it.
CREATE OR REPLACE FUNCTION internal.phone_release_conflict(p_actor uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.verification_phone_proofs p where p.phone=p_phone and p.owner_id=p_actor)
    or exists(select 1 from private.banned_phone_numbers n
      join private.accepted_identity_facts f on f.identity_hmac=n.identity_hmac
      where n.phone=p_phone and f.owner_id=p_actor);
$function$;
alter function internal.phone_release_conflict(uuid,text) owner to postgres;
revoke all on function internal.phone_release_conflict(uuid,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION internal.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');reason_text text;now_at timestamptz;
  blocked integer;waiting integer;mine integer;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' then
    raise exception 'valid phone number required' using errcode='22023';end if;
  reason_text:=internal.privacy_text(p_reason,10,500);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  -- The number's unreleased rows under running bans, locked; how many carry a
  -- waiting request, and how many carry this staff member's same request.
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  select count(*),count(*) filter(where n.release_proposed_at>now_at-interval '7 days'),
      count(*) filter(where n.release_proposed_at>now_at-interval '7 days' and n.release_proposed_by=actor and n.release_reason=reason_text)
    into blocked,waiting,mine
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if blocked=0 then
    raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  -- A request waits when it covers every ban row of the number. One that
  -- covers only some (a later ban of another person added a row) is replaced.
  if waiting=blocked then
    if mine=blocked then
      return jsonb_build_object('phone',p_phone,'status','proposed','reused',true);end if;
    raise exception 'a release is already waiting' using errcode='PT409',detail='phone_release_pending';
  end if;
  update private.banned_phone_numbers n set release_reason=reason_text,release_proposed_by=actor,release_proposed_at=now_at
    from private.banned_identities b
    where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  perform internal.staff_actor('account:restore');
  return jsonb_build_object('phone',p_phone,'status','proposed');
end$function$;
alter function internal.propose_phone_number_release(text,text) owner to postgres;
revoke all on function internal.propose_phone_number_release(text,text) from public,anon,authenticated,service_role;
grant execute on function internal.propose_phone_number_release(text,text) to authenticated;

CREATE OR REPLACE FUNCTION api.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.propose_phone_number_release(p_phone,p_reason)$function$;
alter function api.propose_phone_number_release(text,text) owner to postgres;
revoke all on function api.propose_phone_number_release(text,text) from public,anon,authenticated,service_role;
grant execute on function api.propose_phone_number_release(text,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.review_phone_number_release(p_phone text, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz;
  blocked integer;waiting integer;proposer uuid;holder uuid;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_approve is null then
    raise exception 'valid phone number and decision required' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  select count(*),count(*) filter(where n.release_proposed_at>now_at-interval '7 days'),
      min(n.release_proposed_by::text) filter(where n.release_proposed_at>now_at-interval '7 days')::uuid
    into blocked,waiting,proposer
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if blocked=0 then
    -- The same approval sent again after it was applied.
    if p_approve and exists(select 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
        where n.phone=p_phone and n.released_by=actor and b.retain_until>now_at) then
      return jsonb_build_object('phone',p_phone,'status','released','reused',true);end if;
    raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';
  end if;
  if waiting<>blocked or proposer is null then
    raise exception 'no release is waiting' using errcode='PT409',detail='phone_release_not_pending';end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  if not p_approve then
    update private.banned_phone_numbers n set release_reason=null,release_proposed_by=null,release_proposed_at=null
      from private.banned_identities b
      where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
    perform internal.staff_actor('account:restore');
    return jsonb_build_object('phone',p_phone,'status','rejected');
  end if;
  if proposer=actor then
    raise exception 'a different staff member must approve this release' using errcode='42501',detail='phone_release_same_staff';end if;
  if not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='account:restore'
      where s.user_id=proposer and s.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=proposer) then
    raise exception 'release request expired or changed' using errcode='PT409',detail='phone_release_changed';end if;
  -- The banned person's account may still hold the number as an active proof;
  -- revoke that one proof so whoever holds the number now can verify it.
  select p.owner_id into holder from private.verification_phone_proofs p
    where p.phone=p_phone and p.revoked_at is null
      and p.owner_id in(select f.owner_id from private.accepted_identity_facts f
        join private.banned_phone_numbers n on n.identity_hmac=f.identity_hmac where n.phone=p_phone);
  if holder is not null then
    perform internal.lock_verification_subject(holder);
    update private.verification_phone_proofs set revoked_at=clock_timestamp()
      where owner_id=holder and phone=p_phone and revoked_at is null;
  end if;
  update private.banned_phone_numbers n set released_by=actor,released_at=now_at
    from private.banned_identities b
    where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  perform internal.staff_actor('account:restore');
  return jsonb_build_object('phone',p_phone,'status','released');
end$function$;
alter function internal.review_phone_number_release(text,boolean) owner to postgres;
revoke all on function internal.review_phone_number_release(text,boolean) from public,anon,authenticated,service_role;
grant execute on function internal.review_phone_number_release(text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION api.review_phone_number_release(p_phone text, p_approve boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.review_phone_number_release(p_phone,p_approve)$function$;
alter function api.review_phone_number_release(text,boolean) owner to postgres;
revoke all on function api.review_phone_number_release(text,boolean) from public,anon,authenticated,service_role;
grant execute on function api.review_phone_number_release(text,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();
begin
  return jsonb_build_object('actor_id',actor,
    'pending',coalesce((select jsonb_agg(jsonb_build_object('phone',w.phone,'reason',w.release_reason,
        'proposed_at',w.release_proposed_at,'expires_at',w.release_proposed_at+interval '7 days',
        'proposed_by_name',internal.profile_public_name(p.display_name),
        'proposed_by_me',w.release_proposed_by is not distinct from actor,
        'conflicted',internal.phone_release_conflict(actor,w.phone)) order by w.release_proposed_at desc,w.phone)
      from (select distinct on(n.phone) n.phone,n.release_reason,n.release_proposed_by,n.release_proposed_at
          from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
          where n.released_at is null and b.retain_until>now_at and n.release_proposed_at>now_at-interval '7 days'
          order by n.phone,n.release_proposed_at desc) w
        left join private.profiles p on p.account_id=w.release_proposed_by),'[]'::jsonb),
    'released',coalesce((select jsonb_agg(jsonb_build_object('phone',r.phone,'reason',r.release_reason,
        'proposed_by_name',internal.profile_public_name(pp.display_name),
        'released_by_name',internal.profile_public_name(rp.display_name),
        'released_at',r.released_at) order by r.released_at desc,r.phone)
      from (select * from (select distinct on(n.phone) n.phone,n.release_reason,n.release_proposed_by,n.released_by,n.released_at
            from private.banned_phone_numbers n where n.released_at is not null
            order by n.phone,n.released_at desc) latest
          order by latest.released_at desc,latest.phone limit 50) r
        left join private.profiles pp on pp.account_id=r.release_proposed_by
        left join private.profiles rp on rp.account_id=r.released_by),'[]'::jsonb));
end$function$;
alter function internal.get_phone_number_releases() owner to postgres;
revoke all on function internal.get_phone_number_releases() from public,anon,authenticated,service_role;
grant execute on function internal.get_phone_number_releases() to authenticated;

CREATE OR REPLACE FUNCTION api.get_phone_number_releases()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_phone_number_releases()$function$;
alter function api.get_phone_number_releases() owner to postgres;
revoke all on function api.get_phone_number_releases() from public,anon,authenticated,service_role;
grant execute on function api.get_phone_number_releases() to authenticated;

notify pgrst,'reload schema';
commit;
