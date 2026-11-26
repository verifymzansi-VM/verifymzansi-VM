-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.review_phone_number_release(p_phone text, p_proposed_at timestamp with time zone, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz;
  blocked integer;carrying integer;mine boolean;proposer uuid;holder uuid;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' or p_proposed_at is null or p_approve is null then
    raise exception 'valid phone number, request and decision required' using errcode='22023';end if;
  -- The banned person's account that may still hold the number as an active
  -- proof is locked first, as lifting a restriction locks its subject before
  -- the ban rows.
  if p_approve then
    select p.owner_id into holder from private.verification_phone_proofs p
      where p.phone=p_phone and p.revoked_at is null
        and p.owner_id in(select f.owner_id from private.accepted_identity_facts f
          join private.banned_phone_numbers n on n.identity_hmac=f.identity_hmac
          where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_at is null);
    if holder is not null then perform internal.lock_verification_subject(holder);end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  -- The number's unreleased rows, the rows carrying the request the staff
  -- member saw, whether they proposed any waiting row, and its proposer.
  select count(*),
      count(*) filter(where n.release_proposed_at=p_proposed_at and p_proposed_at>now_at-interval '7 days'),
      coalesce(bool_or(n.release_proposed_by=actor) filter(where n.release_proposed_at>now_at-interval '7 days'),false),
      min(n.release_proposed_by::text) filter(where n.release_proposed_at=p_proposed_at)::uuid
    into blocked,carrying,mine,proposer
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if carrying=0 then
    -- The same approval sent again after it was applied.
    if p_approve and exists(select 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
        where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_by=actor and b.retain_until>now_at) then
      return jsonb_build_object('phone',p_phone,'status','released','reused',true);end if;
    if blocked=0 then
      raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';end if;
    raise exception 'no release is waiting' using errcode='PT409',detail='phone_release_not_pending';
  end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  if not p_approve then
    update private.banned_phone_numbers n set release_reason=null,release_proposed_by=null,release_proposed_at=null
      from private.banned_identities b
      where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at
        and n.release_proposed_at=p_proposed_at;
    perform internal.staff_actor('account:restore');
    return jsonb_build_object('phone',p_phone,'status','rejected');
  end if;
  if mine then
    raise exception 'a different staff member must approve this release' using errcode='42501',detail='phone_release_same_staff';end if;
  -- Approval needs the request to cover every ban row of the number (a later
  -- ban may have added one) and its proposer to still hold the capability.
  if carrying<>blocked or proposer is null
    or not exists(select 1 from private.staff_roles s join private.staff_capabilities c on c.role=s.role and c.capability='account:restore'
      where s.user_id=proposer and s.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=proposer) then
    raise exception 'release request expired or changed' using errcode='PT409',detail='phone_release_changed';end if;
  -- Revoke the banned person's own active proof of the number (only that
  -- one), so whoever holds the number now can verify it.
  if holder is not null then
    update private.verification_phone_proofs p set revoked_at=clock_timestamp()
      where p.owner_id=holder and p.phone=p_phone and p.revoked_at is null
        and p.owner_id in(select f.owner_id from private.accepted_identity_facts f
          join private.banned_phone_numbers n on n.identity_hmac=f.identity_hmac
          where n.phone=p_phone and n.release_proposed_at=p_proposed_at and n.released_at is null);
  end if;
  update private.banned_phone_numbers n set released_by=actor,released_at=now_at
    from private.banned_identities b
    where b.identity_hmac=n.identity_hmac and n.phone=p_phone and n.released_at is null and b.retain_until>now_at
      and n.release_proposed_at=p_proposed_at;
  perform internal.staff_actor('account:restore');
  return jsonb_build_object('phone',p_phone,'status','released');
end$function$;
alter function internal.review_phone_number_release(text,timestamp with time zone,boolean) owner to postgres;
revoke all on function internal.review_phone_number_release(text,timestamp with time zone,boolean) from public;
grant execute on function internal.review_phone_number_release(text,timestamp with time zone,boolean) to authenticated;
