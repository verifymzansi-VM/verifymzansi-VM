-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.review_phone_number_release(text,boolean) from public;
grant execute on function internal.review_phone_number_release(text,boolean) to authenticated;
