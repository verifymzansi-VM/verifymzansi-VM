-- House slots for administrators (owner's decisions of 19 November 2026).
--
-- Apply after 20261119065758_privacy_tightening_2.sql (filename order; this
-- update does not depend on it and touches none of its functions or tables).
-- Order: apply-first. Nothing in the website uses it: it adds no API command,
-- argument, grant or result field. It refuses with 55000 unless the three
-- functions it adds are absent (or this update's), the two it replaces
-- (internal.frontend_privacy_export_data, internal.run_post_lifecycle) have
-- their reviewed bodies (or this update's) and its table is absent or has
-- this update's shape. In one
-- transaction it:
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
--    active admin role, a verified authenticator app and an accepted ID review
--    of a different person: approval needs a second ID-verified person (the
--    approver's verified identity must differ from the recipient's; an
--    identity is active on one account only). Both staff role rows
--    are locked first, so a role removal at the same moment either waits for
--    the grant (and then ends what it added) or is seen by it.
--    It refuses (55000 house_slots_isolation) outside a read committed
--    transaction, so the count it reads after that lock is current.
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
--    of an account that no longer holds an active admin role. Removing a
--    role can never fail or wait because of a post: the slot itself is
--    revoked first (the only row it waits for, never held for long), which at
--    once stops any activation (internal.activate_post and
--    internal.entitlement_for_post_eligible need an active slot) and takes
--    its posts out of public view (private.public_eligible_posts needs an
--    active slot). Slots are revoked in the order internal.activate_post
--    locks them (end date, then id), so the two never deadlock. Its posts
--    are then released with FOR NO KEY UPDATE SKIP LOCKED (a key-share lock
--    from a row referring to the post does not stop it): a post in use at
--    that moment keeps its open activation on the revoked slot, out of
--    public view, until the next run of the lifecycle job.
-- 4. Replaces internal.frontend_privacy_export_data: a member's export gains
--    the dataset `house_slot_events` (their slots' grant, extension and end
--    records: slot, action, end date, time; never the approving administrator
--    or the reason). Every other dataset is unchanged.
-- 5. Replaces internal.run_post_lifecycle: a new first step releases the
--    posts of ended house slots that were in use when the slot ended
--    (internal.end_house_slot again, at most p_limit slots per run, counted
--    in `expired`). Every other step is unchanged. The partial index
--    entitlements_house_slot_ended_idx keeps that step's read small.
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
      ('internal.house_slots_on_staff_role_change()'),
      ('internal.frontend_privacy_export_data(uuid)'),
      ('internal.run_post_lifecycle(integer)')) v(sig)
  loop
    if shape not in (
        'internal.run_post_lifecycle(integer) cb5770e3e71e9e6ed31d1eff3e06e3fc',
        'internal.run_post_lifecycle(integer) 9496376abcf65c764efe02d4971bba5e',
        'internal.frontend_privacy_export_data(uuid) 0b4cd3f792ffecf94c329277db4da28e',
        'internal.frontend_privacy_export_data(uuid) e3842fd91a8d4f6b0bfe4cdc5b3030d9',
        'internal.grant_house_slots(text,integer,integer,text,text) absent',
        'internal.grant_house_slots(text,integer,integer,text,text) 77527fd29f2348e228441612a842cce2',
        'internal.end_house_slot(uuid,text) absent',
        'internal.end_house_slot(uuid,text) 29401d1db1447bd6ad4fe372f73fc08f',
        'internal.house_slots_on_staff_role_change() absent',
        'internal.house_slots_on_staff_role_change() 2ddae0e784aebb3c57e31677de530d9c') then
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
-- 5. The lifecycle job's read of ended house slots.
create index if not exists entitlements_house_slot_ended_idx on private.entitlements (id)
  where source='staff_grant' and status='revoked' and revoked_reason='house_slot_ended';

-- 3. Ending a house slot. The slot is revoked first: the only row this waits
-- for, never held for long. From then on nothing can activate a post in it
-- and its posts are out of public view. Its posts are then released (expired,
-- out of search) with FOR NO KEY UPDATE SKIP LOCKED, so this never waits for
-- a post and can never deadlock with an activation; a post in use at that
-- moment is released when this runs again for the slot (the lifecycle job
-- does so on its next run). The end is recorded once. Returns the number of
-- posts released by this call.
create or replace function internal.end_house_slot(p_entitlement uuid, p_reason text)
 returns integer
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare v_ends timestamptz; v_locked uuid[]; v_post_ids uuid[];
begin
  if p_entitlement is null or not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slot and reason required' using errcode='22023';
  end if;
  update private.entitlements e set status='revoked', revoked_reason='house_slot_ended'
    where e.id=p_entitlement and e.source='staff_grant' and e.status<>'revoked'
      and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
    returning e.ends_at into v_ends;
  if found then
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason)
      values(p_entitlement, 'ended', v_ends, null, p_reason);
  elsif not exists(select 1 from private.entitlements e where e.id=p_entitlement and e.source='staff_grant'
      and e.status='revoked' and e.revoked_reason='house_slot_ended') then
    return 0;
  end if;
  select coalesce(array_agg(x.id), '{}') into v_locked from (select p.id from private.posts p
      where p.id in(select a.post_id from private.post_activations a
        where a.entitlement_id=p_entitlement and a.released_at is null)
      order by p.id for no key update of p skip locked) x;
  with released as (
    update private.post_activations a set released_at=statement_timestamp(), release_reason='entitlement_ended'
    where a.entitlement_id=p_entitlement and a.released_at is null and a.post_id=any(v_locked) returning a.post_id)
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released;
  update private.posts p set status='expired', status_reason='Slot ended', revision=revision+1
    where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
      or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
        where h.post_id=p.id and h.released_at is null)));
  update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
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
      -- The order internal.activate_post locks slots in, so they never deadlock.
      order by e.ends_at, e.id loop
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
declare v_recipient uuid; v_approver uuid; v_identity text; v_approver_identity text; v_ends timestamptz;
  v_held uuid[]; v_slot private.entitlements;
  v_id uuid; v_added integer:=0; v_extended integer:=0;
begin
  -- The count of slots already held is read after the staff role lock; only
  -- read committed sees a grant that committed while this one waited.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'house slots: run this command in a read committed transaction' using errcode='55000',
      detail='house_slots_isolation';
  end if;
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
  v_identity:=internal.current_verified_identity(v_recipient);
  if v_identity is null then
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
  -- Approval needs a second ID-verified person, not only a second account.
  v_approver_identity:=internal.current_verified_identity(v_approver);
  if v_approver_identity is null then
    raise exception 'house slots: the approver''s ID review must be accepted' using errcode='42501',
      detail='house_slots_approver_identity_required';
  end if;
  if v_approver_identity=v_identity then
    raise exception 'house slots: the approver must be a different person' using errcode='42501',
      detail='house_slots_same_person';
  end if;
  v_ends:=statement_timestamp()+make_interval(days=>p_days);
  -- The account's current house slots, locked in the order
  -- internal.activate_post locks slots in (end date, then id).
  select coalesce(array_agg(x.id order by x.ends_at, x.id), '{}') into v_held from (select e.id, e.ends_at
      from private.entitlements e
      where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      order by e.ends_at, e.id for update) x;
  if cardinality(v_held)>p_slots then
    raise exception 'house slots: the account already holds % house slots; this command only adds or extends them',
      cardinality(v_held) using errcode='22023', detail='house_slots_count_invalid';
  end if;
  for v_slot in select e.* from private.entitlements e where e.id=any(v_held) and e.ends_at<v_ends order by e.ends_at, e.id loop
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

-- 4. A member's privacy export lists their house slot records (the full
-- function; only the dataset house_slot_events is new).
CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('house_slot_events',$q$select h.entitlement_id,h.action,h.ends_at,h.recorded_at from private.house_slot_events h
      join private.entitlements e on e.id=h.entitlement_id where e.owner_id=$1 order by h.recorded_at,h.id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('signup_terms',$q$select version,document_hash,method,accepted_at from private.signup_terms_acceptances where account_id=$1$q$),
    ('communication_choices',$q$select purpose,granted,wording_version,recorded_at from private.communication_choice_events
      where account_id=$1 order by recorded_at,id$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

-- 5. The lifecycle job finishes ended house slots (the full function; only
-- step 0 is new).
CREATE OR REPLACE FUNCTION internal.run_post_lifecycle(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n_expired integer:=0; n_notices integer:=0; n_deleted integer:=0; n_extended integer:=0; n_kept integer:=0;
  r record; post private.posts; changed integer; decision jsonb; funded timestamptz;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023';
  end if;
  -- 0. House slots that ended while one of their posts was in use
  -- (20261119082834_house_slots.sql): release those posts now.
  for r in
    select e.id from private.entitlements e
    where e.source='staff_grant' and e.status='revoked' and e.revoked_reason='house_slot_ended'
      and exists(select 1 from private.post_activations a where a.entitlement_id=e.id and a.released_at is null)
    order by e.id limit p_limit
  loop
    n_expired:=n_expired+internal.end_house_slot(r.id,'Admin role removed');
  end loop;
  -- 1. Expiry. A Market or Business post whose paid run has ended expires,
  -- whether live or paused while it still holds its slot. Events are not
  -- expired: they are deleted when they end (step 3). A post under a staff
  -- hold keeps its state until the hold is released. A post whose end date
  -- passed while its slot runs on in a renewal (20261114093742) is not
  -- expired: its end date moves to the end of the slot's run; a post whose
  -- slot run ended early (a renewal revoked) expires although its end date
  -- has not come.
  -- Candidates are read by date only (posts_paid_run_due_idx,
  -- post_search_documents_due_idx, against the statement's time so the
  -- indexes bound the read): posts whose own end date has passed, and live
  -- posts whose search document's end has passed before it (a revoked renewal
  -- moves the document's end back to the slot's remaining run).
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select c.id,c.owner_id from (
      (select p.id,p.owner_id,p.visible_until as due from private.posts p
        where p.kind<>'event' and p.status in('live','paused') and p.visible_until<=statement_timestamp()
          and (p.status='live' or (select true from private.post_activations a
            where a.post_id=p.id and a.released_at is null))
          and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
          and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
        order by p.visible_until,p.id limit p_limit)
      union all
      (select p.id,p.owner_id,d.visible_until from private.post_search_documents d join private.posts p on p.id=d.post_id
        where d.is_visible and d.kind<>'event' and d.visible_until<=statement_timestamp()
          and p.kind<>'event' and p.status='live' and p.visible_until>statement_timestamp()
          and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
          and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
        order by d.visible_until,d.post_id limit p_limit)
    ) c order by c.due,c.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.kind<>'event'
      and (p.status='live' or (p.status='paused' and exists(select 1 from private.post_activations a
        where a.post_id=p.id and a.released_at is null)))
      for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=r.id and h.released_at is null) then continue; end if;
    select max(f.funded_until) into funded from internal.post_funding(post.id) f;
    if funded>clock_timestamp() then
      -- Still funded through its slot: only its end dates catch up.
      if post.visible_until is distinct from funded then
        update private.posts set visible_until=funded where id=post.id;
      end if;
      update private.post_search_documents set visible_until=funded
        where post_id=post.id and visible_until is distinct from funded;
      continue;
    end if;
    continue when post.visible_until>clock_timestamp() and exists(select 1 from private.post_activations a
      join private.entitlements g on g.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null and internal.slot_grant_usable(g.id,g.status,g.starts_at,g.ends_at));
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- 2. Notices. At most p_limit new notices per invocation; old dedupe rows
  -- do not starve later notices. Lock/recheck each post so a concurrent change
  -- invalidates the captured revision first. The expiry notice keys on
  -- ended_at, which edits do not move; its ':3d' suffix gives posts that ended
  -- before this update one notice of the 3-day rule. The sold notice keys on
  -- the slot the post was sold in (its last activation, released or not), so
  -- neither a refund freeing the slot nor undoing and redoing "sold" repeats it.
  -- A post already due for deletion gets the deletion notice instead. A held
  -- post is not warned about a deletion that will not happen; an idle post's
  -- clock counts from the release of its last staff hold. A paused post that
  -- holds a slot is not idle: it expires with its run.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.ended_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.ended_at))::bigint||':3d' as dedupe_key
      from private.posts p where p.status='expired' and p.kind<>'event' and p.deletes_at>clock_timestamp()
      union all
      select 'post_sold',p.id,p.owner_id,p.revision,p.ended_at,
        'post_sold:'||p.id||':'||coalesce((select a.id::text from private.post_activations a
          where a.post_id=p.id and a.activated_at<=p.ended_at order by a.activated_at desc,a.id desc limit 1),'none')
      from private.posts p where p.status='sold' and p.deletes_at>clock_timestamp()
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,i.idle_since+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from i.idle_since))::bigint
      from private.posts p cross join lateral (select greatest(p.content_updated_at,p.status_changed_at,
        (select max(h.released_at) from private.frontend_content_holds h where h.post_id=p.id)) as idle_since) i
      where (p.status in('draft','rejected') or (p.status='paused' and not exists(select 1 from private.post_activations a
          where a.post_id=p.id and a.released_at is null)))
        and i.idle_since<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=n.id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=r.id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  -- 3. Deletion: ended runs at their deletion date (moved by the late-payment
  -- rule, internal.ended_post_decision), events that have ended, and idle
  -- drafts, rejected posts and paused posts without a slot, unless an open
  -- report keeps the post a little longer (internal.post_report_deferred).
  -- Deleting a post releases its slot (posts_release_activation). The payment
  -- rule is evaluated only for posts that are due or whose owner has confirmed
  -- a recent plan payment.
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and (p.deletes_at<=clock_timestamp()
          or (p.status='expired' and p.kind<>'event' and exists(select 1 from private.payments pay
            where pay.owner_id=p.owner_id and pay.product_kind='plan' and pay.created_at>=p.ended_at-interval '24 hours'
              and pay.status='complete' and pay.fulfillment_status='fulfilled')))
          and internal.ended_post_decision(p) is not null)
        or (p.kind='event' and p.edit_of is null and p.status not in('expired','sold','archived')
          and p.deletes_at<=clock_timestamp() and exists(select 1 from private.event_details e
            where e.post_id=p.id and e.ends_at<=clock_timestamp()))
        or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'
          and internal.post_idle_deletion_due(p)))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)
      and not internal.post_report_deferred(p)
    order by coalesce(p.deletes_at,p.status_changed_at),p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.frontend_content_holds h where h.post_id=post.id and h.released_at is null) then continue; end if;
    if post.status in('expired','sold','archived') then
      decision:=internal.ended_post_decision(post);
      if decision is null then continue; end if;
      if decision->>'action' in('extend','keep') then
        insert into private.post_deletion_extensions(post_id,ended_at,grace_ended_at,payment_id,kept_at)
          values(post.id,post.ended_at,(decision->>'grace_ended_at')::timestamptz,(decision->>'payment_id')::uuid,
            case when decision->>'action'='keep' then clock_timestamp() end)
          on conflict(post_id) do update set ended_at=excluded.ended_at,grace_ended_at=excluded.grace_ended_at,
            payment_id=excluded.payment_id,extended_at=excluded.extended_at,kept_at=excluded.kept_at;
        update private.posts set deletes_at=(decision->>'deletes_at')::timestamptz where id=post.id;
        if decision->>'action'='keep' then
          insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
            values('post_kept',post.id,post.owner_id,'post_kept:'||post.id||':'||floor(extract(epoch from post.ended_at))::bigint)
            on conflict(dedupe_key) do nothing;
          n_kept:=n_kept+1;
        else
          n_extended:=n_extended+1;
        end if;
        continue;
      end if;
    elsif not ((post.kind='event' and post.edit_of is null and post.deletes_at<=clock_timestamp()
        and exists(select 1 from private.event_details e where e.post_id=post.id and e.ends_at<=clock_timestamp()))
      or internal.post_idle_deletion_due(post)) then
      continue;
    end if;
    if internal.post_report_deferred(post) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  -- Free-event submissions older than every rolling 30-day window.
  delete from private.event_submissions s where s.id in(select x.id from private.event_submissions x
    where x.submitted_at<=clock_timestamp()-interval '31 days' order by x.submitted_at limit p_limit);
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted,'extended',n_extended,'kept',n_kept);
end;
$function$;
alter function internal.run_post_lifecycle(integer) owner to postgres;
revoke all on function internal.run_post_lifecycle(integer) from public;
grant execute on function internal.run_post_lifecycle(integer) to service_role;

notify pgrst,'reload schema';
commit;
