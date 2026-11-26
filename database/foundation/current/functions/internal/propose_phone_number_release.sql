-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');reason_text text;now_at timestamptz;
  blocked integer;waiting integer;requests integer;mine integer;
begin
  if p_phone is null or p_phone !~ '^\+27[0-9]{9}$' then
    raise exception 'valid phone number required' using errcode='22023';end if;
  reason_text:=internal.privacy_text(p_reason,10,500);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('phone-release:'||p_phone,2702));
  actor:=internal.staff_actor('account:restore');now_at:=clock_timestamp();
  -- The number's unreleased rows under running bans, locked; how many carry a
  -- waiting request, in how many requests, and how many carry this staff
  -- member's same request.
  perform 1 from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at for update of n;
  select count(*),count(*) filter(where n.release_proposed_at>now_at-interval '7 days'),
      count(distinct n.release_proposed_at) filter(where n.release_proposed_at>now_at-interval '7 days'),
      count(*) filter(where n.release_proposed_at>now_at-interval '7 days' and n.release_proposed_by=actor and n.release_reason=reason_text)
    into blocked,waiting,requests,mine
    from private.banned_phone_numbers n join private.banned_identities b on b.identity_hmac=n.identity_hmac
    where n.phone=p_phone and n.released_at is null and b.retain_until>now_at;
  if blocked=0 then
    raise exception 'phone number not blocked' using errcode='PT404',detail='phone_not_blocked';end if;
  if internal.phone_release_conflict(actor,p_phone) then
    raise exception 'staff who verified this number cannot release it' using errcode='42501',detail='phone_release_conflict';end if;
  -- A request waits when one request covers every ban row of the number. One
  -- that covers only some (a later ban added a row) is replaced.
  if waiting=blocked and requests=1 then
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
revoke all on function internal.propose_phone_number_release(text,text) from public;
grant execute on function internal.propose_phone_number_release(text,text) to authenticated;
