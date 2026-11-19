-- House slots for administrators (owner's decisions of 19 November 2026).
--
-- Apply after 20261119065758_privacy_tightening_2.sql (filename order; this
-- update does not depend on it and touches none of its functions or tables).
-- Order: apply-first. Nothing in the website uses it: it adds no API command,
-- argument, grant or result field. It refuses with 55000 unless the three
-- functions it adds are absent (or this update's) and its table and trigger
-- are absent or complete. In one transaction it:
--
-- 1. Adds the append-only table private.house_slot_events: one row per house
--    slot granted, extended or ended (the slot, the action, the slot's end
--    after it, the approving administrator, a written reason, the time). Row
--    level security on, no grants to any API role; updates, deletes and
--    truncation are refused (internal.append_only_guard), except deletes by
--    the retention job, which removes a slot's events with the slot (on delete
--    cascade) once the slot itself is due for deletion.
-- 2. Adds internal.grant_house_slots(recipient email, slots, days, reason,
--    approver email), which only the database owner can run (execute revoked
--    from public, granted to no API role; run in the Supabase SQL editor, like
--    internal.bootstrap_first_administrator). It makes the recipient hold
--    `slots` (1 to 15) house slots, each running until `days` (7 to 180) days
--    from now: current house slots that end earlier are extended to that date
--    (never shortened), and new ones are added up to `slots`. It refuses
--    (22023) a count or term outside those ranges, a reason that is not 5 to
--    500 characters of plain text, and a count below the house slots the
--    account already holds. It refuses (42501) unless the recipient is a
--    confirmed, active account with an active admin role, an accepted ID
--    review (internal.current_verified_identity) and a verified authenticator
--    app, and the approver is a different confirmed, active account with an
--    active admin role and a verified authenticator app. Both staff role rows
--    are locked first, so a role removal at the same moment either waits for
--    the grant (and then ends what it added) or is seen by it.
--    A house slot is a `staff_grant` entitlement with exactly the shape of a
--    paid Individual slot: any posting area, 1 live post, 4 posts going live
--    per 30 days, 10 photos and 1 video, no add-ons; granted_by is the
--    approving administrator. It has no payment, so it never appears in
--    revenue, commission, refunds or invoices, it is not counted in the 4 paid
--    Individual slots (internal.individual_slots_counted counts paid slots
--    only), and it does not use the free first post (no trial_identities row).
--    Posts in it follow every normal rule: internal.submit_post and
--    internal.activate_post are unchanged (form, posting terms, contacts, ID
--    review, media limits, fair use, moderation, expiry).
-- 3. Adds internal.end_house_slot(slot, reason), which revokes a house slot,
--    releases its posts (expired, left out of search) as a sponsorship's end
--    does, and records the end; and the trigger
--    staff_roles_end_house_slots on private.staff_roles (after a role is
--    revoked, changed or deleted), whose function
--    internal.house_slots_on_staff_role_change ends every current house slot
--    of an account that no longer holds an active admin role.
--
-- No existing row is changed. Read-only preflight:
-- ../preflight/20261119082834_house_slots.check.sql. Rollback:
-- ../rollback/20261119082834_house_slots.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Preconditions: the functions this update adds are absent (or this update's).
do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.grant_house_slots(text,integer,integer,text,text)'),
      ('internal.end_house_slot(uuid,text)'),
      ('internal.house_slots_on_staff_role_change()')) v(sig)
  loop
    if shape not in (
        'internal.grant_house_slots(text,integer,integer,text,text) absent',
        'internal.grant_house_slots(text,integer,integer,text,text) d456341442ebecc2d5a28d2b824d4433',
        'internal.end_house_slot(uuid,text) absent',
        'internal.end_house_slot(uuid,text) bbd9eded84273b962814a997daaed2e4',
        'internal.house_slots_on_staff_role_change() absent',
        'internal.house_slots_on_staff_role_change() f100ded1785d690054ba54e150e33bff') then
      raise exception 'house slots precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if pg_catalog.to_regclass('private.house_slot_events') is not null and not exists(
      select 1 from pg_catalog.pg_attribute a where a.attrelid=pg_catalog.to_regclass('private.house_slot_events')
        and a.attname='approved_by' and not a.attisdropped) then
    raise exception 'house slots precondition: private.house_slot_events exists with another shape' using errcode='55000';
  end if;
end$$;

-- 1. The append-only record of every house slot granted, extended or ended.
create table if not exists private.house_slot_events (
  id uuid not null default gen_random_uuid(),
  entitlement_id uuid not null,
  action text not null,
  ends_at timestamptz not null,
  approved_by uuid,
  reason text not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint house_slot_events_pkey primary key (id),
  constraint house_slot_events_entitlement_id_fkey foreign key (entitlement_id)
    references private.entitlements(id) on delete cascade,
  constraint house_slot_events_approved_by_fkey foreign key (approved_by)
    references auth.users(id) on delete restrict,
  constraint house_slot_events_action_check check (action in ('granted', 'extended', 'ended')),
  constraint house_slot_events_approver_check check ((action = 'ended') = (approved_by is null)),
  constraint house_slot_events_reason_check check (char_length(reason) between 5 and 500)
);
alter table private.house_slot_events owner to postgres;
alter table private.house_slot_events enable row level security;
revoke all on private.house_slot_events from public, anon, authenticated, service_role;
create index if not exists house_slot_events_entitlement_idx
  on private.house_slot_events (entitlement_id, recorded_at);
create index if not exists house_slot_events_approved_by_idx
  on private.house_slot_events (approved_by) where approved_by is not null;
drop trigger if exists house_slot_events_append_only on private.house_slot_events;
create trigger house_slot_events_append_only before delete or update on private.house_slot_events
  for each row execute function internal.append_only_guard();
drop trigger if exists house_slot_events_no_truncate on private.house_slot_events;
create trigger house_slot_events_no_truncate before truncate on private.house_slot_events
  for each statement execute function internal.append_only_guard();

-- 3. Ending a house slot: the slot is revoked, its posts are released
-- (expired, out of search) and the end is recorded. Posts first, then the
-- slot, as internal.release_sponsorship_entitlement locks them.
create or replace function internal.end_house_slot(p_entitlement uuid, p_reason text)
 returns integer
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare v_post_ids uuid[]; v_ends timestamptz;
begin
  if p_entitlement is null or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slot and reason required' using errcode='22023';
  end if;
  perform p.id from private.posts p where p.id in(select a.post_id from private.post_activations a
    where a.entitlement_id=p_entitlement and a.released_at is null) order by p.id for update of p;
  update private.entitlements e set status='revoked', revoked_reason='house_slot_ended'
    where e.id=p_entitlement and e.source='staff_grant' and e.status<>'revoked'
      and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
    returning e.ends_at into v_ends;
  if not found then
    return 0;
  end if;
  with released as (
    update private.post_activations a set released_at=statement_timestamp(), release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null returning a.post_id)
  select coalesce(array_agg(post_id) filter(where post_id is not null), '{}') into v_post_ids from released;
  update private.posts p set status='expired', status_reason='Slot ended', revision=revision+1
    where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
      or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
        where h.post_id=p.id and h.released_at is null)));
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
    values(p_entitlement, 'ended', v_ends, null, p_reason);
  return cardinality(v_post_ids);
end;
$function$;
alter function internal.end_house_slot(uuid,text) owner to postgres;
revoke all on function internal.end_house_slot(uuid,text) from public;

-- 3. House slots end at once when the account no longer holds an active
-- admin role (revoked, changed to another role, or the row deleted).
create or replace function internal.house_slots_on_staff_role_change()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare v_user uuid; v_slot uuid;
begin
  if tg_op='DELETE' then
    v_user:=old.user_id;
  else
    v_user:=new.user_id;
  end if;
  if exists(select 1 from private.staff_roles r where r.user_id=v_user and r.role='admin' and r.revoked_at is null) then
    return null;
  end if;
  for v_slot in select e.id from private.entitlements e
      where e.owner_id=v_user and e.source='staff_grant' and e.status<>'revoked' and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      order by e.id loop
    perform internal.end_house_slot(v_slot, 'Admin role removed');
  end loop;
  return null;
end;
$function$;
alter function internal.house_slots_on_staff_role_change() owner to postgres;
revoke all on function internal.house_slots_on_staff_role_change() from public;
drop trigger if exists staff_roles_end_house_slots on private.staff_roles;
create trigger staff_roles_end_house_slots after delete or update of revoked_at, role on private.staff_roles
  for each row execute function internal.house_slots_on_staff_role_change();

-- 2. Granting and extending house slots: database owner only.
create or replace function internal.grant_house_slots(p_recipient_email text, p_slots integer, p_days integer,
  p_reason text, p_approved_by_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare v_recipient uuid; v_approver uuid; v_ends timestamptz; v_held uuid[]; v_slot private.entitlements;
  v_id uuid; v_added integer:=0; v_extended integer:=0;
begin
  if p_slots is null or p_slots<1 or p_slots>15 then
    raise exception 'house slots: choose 1 to 15 slots' using errcode='22023', detail='house_slots_count_invalid';
  end if;
  if p_days is null or p_days<7 or p_days>180 then
    raise exception 'house slots: choose a term of 7 to 180 days' using errcode='22023', detail='house_slots_term_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slots: a written reason of 5 to 500 characters is required' using errcode='22023',
      detail='house_slots_reason_required';
  end if;
  select u.id into v_recipient from auth.users u
    where lower(u.email)=lower(btrim(p_recipient_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  select u.id into v_approver from auth.users u
    where lower(u.email)=lower(btrim(p_approved_by_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  if v_recipient is null then
    raise exception 'house slots: a confirmed recipient account is required' using errcode='42501',
      detail='house_slots_recipient_invalid';
  end if;
  if v_approver is null then
    raise exception 'house slots: a confirmed approving administrator account is required' using errcode='42501',
      detail='house_slots_approver_invalid';
  end if;
  if v_approver=v_recipient then
    raise exception 'house slots: the approver must be a different administrator account' using errcode='42501',
      detail='house_slots_self_approval';
  end if;
  -- Both current staff roles, in one order: a role removal at the same moment
  -- waits for this grant (and then ends what it added), or this grant sees it.
  perform r.id from private.staff_roles r where r.user_id in(v_recipient, v_approver) and r.revoked_at is null
    order by r.id for update;
  if not exists(select 1 from private.staff_roles r where r.user_id=v_recipient and r.role='admin' and r.revoked_at is null) then
    raise exception 'house slots: the recipient must hold an active admin role' using errcode='42501',
      detail='house_slots_not_admin';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id=v_recipient) then
    raise exception 'house slots: the recipient account is not active' using errcode='42501',
      detail='house_slots_recipient_inactive';
  end if;
  if internal.current_verified_identity(v_recipient) is null then
    raise exception 'house slots: the recipient''s ID review must be accepted' using errcode='42501',
      detail='house_slots_identity_required';
  end if;
  if not exists(select 1 from auth.mfa_factors f where f.user_id=v_recipient and f.factor_type='totp' and f.status='verified') then
    raise exception 'house slots: the recipient needs a verified authenticator app' using errcode='42501',
      detail='house_slots_mfa_required';
  end if;
  if not exists(select 1 from private.staff_roles r where r.user_id=v_approver and r.role='admin' and r.revoked_at is null)
    or not exists(select 1 from private.current_account_access a where a.id=v_approver)
    or not exists(select 1 from auth.mfa_factors f where f.user_id=v_approver and f.factor_type='totp' and f.status='verified') then
    raise exception 'house slots: the approver must be an active administrator with a verified authenticator app'
      using errcode='42501', detail='house_slots_approver_invalid';
  end if;
  v_ends:=statement_timestamp()+make_interval(days=>p_days);
  -- The account's current house slots.
  select coalesce(array_agg(x.id order by x.id), '{}') into v_held from (select e.id from private.entitlements e
      where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      order by e.id for update) x;
  if cardinality(v_held)>p_slots then
    raise exception 'house slots: the account already holds % house slots; this command only adds or extends them',
      cardinality(v_held) using errcode='22023', detail='house_slots_count_invalid';
  end if;
  for v_slot in select e.* from private.entitlements e where e.id=any(v_held) and e.ends_at<v_ends order by e.id loop
    update private.entitlements set ends_at=v_ends where id=v_slot.id;
    perform internal.refresh_slot_chain_documents(v_slot.id);
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(v_slot.id, 'extended', v_ends, v_approver, p_reason);
    v_extended:=v_extended+1;
  end loop;
  for i in 1..(p_slots-cardinality(v_held)) loop
    insert into private.entitlements(owner_id, source, area, granted_by, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values(v_recipient, 'staff_grant', null, v_approver, 1, 4, 30, 10, 1, statement_timestamp(), v_ends, '{}')
      returning id into v_id;
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(v_id, 'granted', v_ends, v_approver, p_reason);
    v_added:=v_added+1;
  end loop;
  return jsonb_build_object('account_id', v_recipient, 'approved_by', v_approver, 'house_slots', p_slots,
    'added', v_added, 'extended', v_extended,
    'slots', (select jsonb_agg(jsonb_build_object('id', e.id, 'ends_at', e.ends_at) order by e.ends_at, e.id)
      from private.entitlements e where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)));
end;
$function$;
alter function internal.grant_house_slots(text,integer,integer,text,text) owner to postgres;
revoke all on function internal.grant_house_slots(text,integer,integer,text,text) from public;
revoke all on function internal.grant_house_slots(text,integer,integer,text,text) from anon, authenticated, service_role;

notify pgrst,'reload schema';
commit;
