-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.give_free_credit(p_email text, p_posts integer, p_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('free_credit:give');
  v_member uuid;
  v_ends timestamptz;
  v_id uuid;
begin
  if p_posts is null or p_posts not between 1 and 6 then
    raise exception 'free credits: choose 1 to 6 posts' using errcode='22023', detail='free_credit_posts_invalid';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'free credits: choose 1 to 30 days' using errcode='22023', detail='free_credit_days_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 200, false), false) then
    raise exception 'free credits: a reason of 5 to 200 characters is required' using errcode='22023',
      detail='free_credit_reason_required';
  end if;
  select u.id into v_member from auth.users u
    where lower(u.email)=lower(btrim(p_email)) and u.deleted_at is null and u.is_anonymous is false;
  if v_member is null or not exists(select 1 from private.current_account_access a where a.id=v_member) then
    raise exception 'free credits: no active member account has this email' using errcode='PT409',
      detail='free_credit_member_not_found';
  end if;
  -- The rule of staff money actions: the admin has a current accepted ID
  -- review of their own, and the member is not the admin's own account nor
  -- an account ever reviewed as the same person (house slots cover the
  -- admin's own posts).
  perform internal.assert_staff_payment_actor(actor, v_member);
  if internal.current_verified_identity(v_member) is null then
    raise exception 'free credits: the member''s ID review must be accepted first' using errcode='PT409',
      detail='free_credit_identity_required';
  end if;
  -- One running gift per member (extend it instead): concurrent gifts to the
  -- same member wait for each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('free-credit:'||v_member::text, 707));
  actor := internal.staff_actor('free_credit:give'); -- authority after the wait
  if exists(select 1 from private.entitlements e where e.owner_id=v_member and e.source='free_credit'
      and e.status='active' and e.ends_at>statement_timestamp()) then
    raise exception 'free credits: this member already has a running gift; extend it instead' using errcode='PT409',
      detail='free_credit_active';
  end if;
  v_ends := statement_timestamp()+make_interval(days=>p_days);
  insert into private.entitlements(owner_id, source, area, granted_by, slot_capacity, activations_per_period,
      activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
    values(v_member, 'free_credit', null, actor, p_posts, 4*p_posts, 30, 10, 1, statement_timestamp(), v_ends, '{}')
    returning id into v_id;
  insert into private.free_credit_events(entitlement_id, action, actor_id, posts, days, ends_at, reason)
    values(v_id, 'given', actor, p_posts, p_days, v_ends, p_reason);
  return jsonb_build_object('id', v_id, 'posts', p_posts, 'ends_at', v_ends);
end;
$function$;
alter function internal.give_free_credit(text,integer,integer,text) owner to postgres;
revoke all on function internal.give_free_credit(text,integer,integer,text) from public;
grant execute on function internal.give_free_credit(text,integer,integer,text) to authenticated;
