-- Free credits for businesses VerifyMzansi recruits (launch checklist item 70,
-- owner's design of 22 November 2026).
--
-- An admin gives an ID-verified member free posts for a short time: 1 to 6
-- posts for 1 to 30 days, with a short written reason, and may extend a gift
-- by 1 to 30 days at a time, as often as needed. From this update:
--
-- 1. A gift is an entitlement like every other slot, with the new source
--    'free_credit' (private.entitlements): area null (every section), slot
--    capacity 1 to 6, the fair use and media of a paid Individual slot per
--    post (4 posts going live per post per 30 days, 10 photos, 1 video), no
--    add-ons, no payment. New constraint entitlements_free_credit_check: a
--    gift names the admin who gave it and has no payment, area or add-ons.
--    It funds posts through the existing posting and activation commands
--    (internal.activate_post, internal.post_funding, the media checks), which
--    already accept every source other than 'retail_paid' without a payment.
--    It never renews and is never charged: renewals, renewal reminders,
--    Individual slot counts, sales figures, VAT totals and invoices read only
--    'retail_paid' entitlements and payments. It is not a house slot
--    ('staff_grant' with private.house_slot_events) and not the free first
--    post ('intro_trial', private.trial_identities): giving one touches
--    neither.
-- 2. New append-only private.free_credit_events: each gift ('given') and each
--    extension ('extended') with the admin, the time, the gift (whose
--    entitlement names the member), its posts, the days added, the end it set
--    and the reason (5 to 200 characters). Kept as long as the gift's
--    entitlement (deleted with it by the commerce retention, under
--    vm.retention).
-- 3. New staff capabilities for the admin role: free_credit:give (with an
--    authenticator code from the last 15 minutes, like other sensitive admin
--    actions) and free_credit:view (the 12-hour rule).
-- 4. New staff commands (internal twins, security definer; api wrappers,
--    security invoker; authenticated only):
--    - api.give_free_credit(email, posts, days, reason): finds the member by
--      email (an active, confirmed account), refuses one without a current
--      accepted ID review (internal.current_verified_identity), one who
--      already has a running gift (extend that one instead), posts outside 1
--      to 6, days outside 1 to 30 and a missing reason; gives the gift from
--      now.
--    - api.extend_free_credit(gift, days, reason): adds 1 to 30 days from the
--      gift's current end while it runs, otherwise from now; the member must
--      still be active and ID-verified; a gift of an erased account cannot be
--      extended.
--    Both follow the rule of staff money actions
--    (internal.assert_staff_payment_actor): the admin needs a current accepted
--    ID review of their own, and never acts for their own account or an
--    account ever reviewed as the same person. The search end of the gift's live posts follows
--      (internal.refresh_slot_chain_documents, as for house slots).
--    - api.list_free_credits(): the latest 500 gifts, newest first: the
--      member's masked email, posts, start, end, active or ended, and the
--      views of the posts it funded (post_engagement_totals, all time).
-- 5. internal.get_my_frontend_post_manager (the member's slot list on My
--    posts) names the new source FREE_CREDIT; every other field is
--    unchanged. The member's "My slots" list (internal.get_my_slots_v2)
--    already returns every source as stored.
--
-- Expand only: a widened check, one new constraint, a table, two capability
-- rows, six new functions and one new label in a member read. ORDER: apply
-- first, then merge. Until an admin gives the first gift no entitlement has
-- the new source, so the website before this release reads nothing new.
-- It refuses with 55000 unless internal.get_my_frontend_post_manager has its
-- reviewed body (or this update's), each new function is absent (or this
-- update's) and no entitlement already has the source 'free_credit' before
-- the table exists.
-- Read-only preflight: ../preflight/20261122130744_free_credits.check.sql.
-- Rollback: ../rollback/20261122130744_free_credits.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.get_my_frontend_post_manager()'),
      ('internal.give_free_credit(text,integer,integer,text)'),
      ('api.give_free_credit(text,integer,integer,text)'),
      ('internal.extend_free_credit(uuid,integer,text)'),
      ('api.extend_free_credit(uuid,integer,text)'),
      ('internal.list_free_credits()'),
      ('api.list_free_credits()')) v(sig)
  loop
    if shape not in (
        'internal.get_my_frontend_post_manager() c408ccd9ee1a2cc4f135f2b4032f6583',
        'internal.get_my_frontend_post_manager() bf4e28d6a385e6823983ccb93f7315ad',
        'internal.give_free_credit(text,integer,integer,text) absent',
        'internal.give_free_credit(text,integer,integer,text) e883d90c03704304dec1321f365c0f0a',
        'api.give_free_credit(text,integer,integer,text) absent',
        'api.give_free_credit(text,integer,integer,text) a18653758dbfb3177404bd8b083115da',
        'internal.extend_free_credit(uuid,integer,text) absent',
        'internal.extend_free_credit(uuid,integer,text) f932cc79bb3bda5fa606fad58d94e53b',
        'api.extend_free_credit(uuid,integer,text) absent',
        'api.extend_free_credit(uuid,integer,text) 19c0634bbd5418e3eca8e2fb4032f166',
        'internal.list_free_credits() absent',
        'internal.list_free_credits() 3844d1a2876105f451a5267503380582',
        'api.list_free_credits() absent',
        'api.list_free_credits() ef063d6b12ce7a9b30af3af33d792cfe') then
      raise exception 'free credits precondition: % is not a reviewed body', shape using errcode='55000';
    end if;
  end loop;
  if to_regclass('private.free_credit_events') is null
    and exists(select 1 from private.entitlements e where e.source='free_credit') then
    raise exception 'free credits precondition: an entitlement already has the source free_credit' using errcode='55000';
  end if;
end$$;

-- 1. The new entitlement source.
alter table private.entitlements drop constraint if exists entitlements_source_check;
alter table private.entitlements add constraint entitlements_source_check
  check (source = any (array['retail_paid'::text, 'intro_trial'::text, 'sponsorship'::text, 'contract'::text,
    'staff_grant'::text, 'free_credit'::text]));
alter table private.entitlements drop constraint if exists entitlements_free_credit_check;
alter table private.entitlements add constraint entitlements_free_credit_check
  check (source <> 'free_credit'::text or (granted_by is not null and payment_id is null and area is null
    and addon_capabilities = '{}'::text[]));
create index if not exists entitlements_free_credit_idx on private.entitlements (starts_at desc, id)
  where source = 'free_credit'::text;

-- 2. The record of every gift and extension.
create table if not exists private.free_credit_events (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references private.entitlements(id) on delete cascade,
  action text not null check (action in ('given', 'extended')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  posts integer not null check (posts between 1 and 6),
  days integer not null check (days between 1 and 30),
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 5 and 200),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.free_credit_events owner to postgres;
alter table private.free_credit_events enable row level security;
revoke all on private.free_credit_events from public, anon, authenticated, service_role;
create index if not exists free_credit_events_entitlement_idx on private.free_credit_events (entitlement_id, created_at);
create index if not exists free_credit_events_actor_idx on private.free_credit_events (actor_id);
drop trigger if exists free_credit_events_append_only on private.free_credit_events;
create trigger free_credit_events_append_only before update or delete on private.free_credit_events
  for each row execute function internal.append_only_guard();
drop trigger if exists free_credit_events_no_truncate on private.free_credit_events;
create trigger free_credit_events_no_truncate before truncate on private.free_credit_events
  for each statement execute function internal.append_only_guard();
comment on table private.free_credit_events is 'Free credits (20261122130744_free_credits.sql): every gift and extension an admin made, with the reason. Append-only; deleted only with the gift''s entitlement (commerce retention).';

-- 3. The staff capabilities (admin role).
insert into private.staff_capabilities(role, capability, requires_recent_mfa)
  values ('admin', 'free_credit:give', true), ('admin', 'free_credit:view', false)
  on conflict (role, capability) do nothing;

-- 4. The staff commands.
create or replace function internal.give_free_credit(p_email text, p_posts integer, p_days integer, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
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
revoke all on function internal.give_free_credit(text,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function internal.give_free_credit(text,integer,integer,text) to authenticated;

create or replace function api.give_free_credit(p_email text, p_posts integer, p_days integer, p_reason text)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.give_free_credit(p_email, p_posts, p_days, p_reason);
$function$;
alter function api.give_free_credit(text,integer,integer,text) owner to postgres;
revoke all on function api.give_free_credit(text,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function api.give_free_credit(text,integer,integer,text) to authenticated;

create or replace function internal.extend_free_credit(p_credit_id uuid, p_days integer, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare
  actor uuid := internal.staff_actor('free_credit:give');
  v_gift private.entitlements;
  v_ends timestamptz;
begin
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'free credits: choose 1 to 30 days' using errcode='22023', detail='free_credit_days_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 200, false), false) then
    raise exception 'free credits: a reason of 5 to 200 characters is required' using errcode='22023',
      detail='free_credit_reason_required';
  end if;
  -- One extension at a time per gift: the second waits and adds to the end
  -- the first set.
  select e.* into v_gift from private.entitlements e where e.id=p_credit_id and e.source='free_credit' for update;
  if v_gift.id is null then
    raise exception 'free credits: unknown gift' using errcode='22023', detail='free_credit_not_found';
  end if;
  actor := internal.staff_actor('free_credit:give'); -- authority after the row wait
  if v_gift.status<>'active' or v_gift.owner_id is null then
    raise exception 'free credits: this gift can no longer be extended' using errcode='PT409', detail='free_credit_closed';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id=v_gift.owner_id) then
    raise exception 'free credits: no active member account has this email' using errcode='PT409',
      detail='free_credit_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_gift.owner_id);
  if internal.current_verified_identity(v_gift.owner_id) is null then
    raise exception 'free credits: the member''s ID review must be accepted first' using errcode='PT409',
      detail='free_credit_identity_required';
  end if;
  -- From the current end while the gift runs, otherwise from now.
  v_ends := greatest(v_gift.ends_at, statement_timestamp())+make_interval(days=>p_days);
  update private.entitlements set ends_at=v_ends where id=v_gift.id;
  perform internal.refresh_slot_chain_documents(v_gift.id);
  insert into private.free_credit_events(entitlement_id, action, actor_id, posts, days, ends_at, reason)
    values(v_gift.id, 'extended', actor, v_gift.slot_capacity, p_days, v_ends, p_reason);
  return jsonb_build_object('id', v_gift.id, 'posts', v_gift.slot_capacity, 'ends_at', v_ends);
end;
$function$;
alter function internal.extend_free_credit(uuid,integer,text) owner to postgres;
revoke all on function internal.extend_free_credit(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function internal.extend_free_credit(uuid,integer,text) to authenticated;

create or replace function api.extend_free_credit(p_credit_id uuid, p_days integer, p_reason text)
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.extend_free_credit(p_credit_id, p_days, p_reason);
$function$;
alter function api.extend_free_credit(uuid,integer,text) owner to postgres;
revoke all on function api.extend_free_credit(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function api.extend_free_credit(uuid,integer,text) to authenticated;

create or replace function internal.list_free_credits()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
begin
  perform internal.staff_actor('free_credit:view');
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'member', case when u.email is null then null else internal.mask_email(u.email) end,
        'posts', e.slot_capacity,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at,
        'status', case when e.status='active' and e.ends_at>statement_timestamp() then 'active' else 'ended' end,
        'views', (select coalesce(sum(t.views), 0)::bigint from private.post_engagement_totals t
          where t.post_id in (select a.post_id from private.post_activations a
            where a.entitlement_id=e.id and a.post_id is not null)))
      order by e.starts_at desc, e.id)
    from (select x.* from private.entitlements x where x.source='free_credit'
      order by x.starts_at desc, x.id limit 500) e
    left join auth.users u on u.id=e.owner_id), '[]'::jsonb));
end;
$function$;
alter function internal.list_free_credits() owner to postgres;
revoke all on function internal.list_free_credits() from public, anon, authenticated, service_role;
grant execute on function internal.list_free_credits() to authenticated;

create or replace function api.list_free_credits()
 returns jsonb
 language sql
 set search_path to 'pg_catalog'
as $function$
  select internal.list_free_credits();
$function$;
alter function api.list_free_credits() owner to postgres;
revoke all on function api.list_free_credits() from public, anon, authenticated, service_role;
grant execute on function api.list_free_credits() to authenticated;

-- 5. The member's slot list on My posts names the new source; every other
-- field is unchanged.
CREATE OR REPLACE FUNCTION internal.get_my_frontend_post_manager()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();result jsonb;
begin
  select jsonb_build_object('account_id',actor,
    'slot_usage',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'source',case e.source when 'retail_paid' then 'RETAIL_PAID' when 'intro_trial' then 'Free trial'
        when 'sponsorship' then 'SPONSORED_ORGANISATION_MEMBER' when 'contract' then 'ENTERPRISE_CONTRACT' when 'staff_grant' then 'ADMIN_GRANT'
        when 'free_credit' then 'FREE_CREDIT' end,
      'area',case e.area when 'market' then 'MZANSI_MARKET' when 'business' then 'MZANSI_BUSINESS' when 'tourism_events' then 'PROMOTIONS_EVENTS' end,
      'planName',pay.snapshot->>'label','status',e.status,'slotCapacity',e.slot_capacity,
      'activeUsage',internal.slot_posts_held(e.id),
      'activationCount',(select count(*) from private.post_activations a where a.entitlement_id=e.id),
      'activationLimitTotal',null,'activationLimitPerPeriod',e.activations_per_period,'activationPeriodDays',e.activation_period_days,
      'periodActivations',internal.slot_posts_started(e.id,statement_timestamp()-make_interval(days=>e.activation_period_days)),
      'startsAt',e.starts_at,'expiresAt',e.ends_at,'autoRenew',false,'sponsored',e.source='sponsorship') order by e.ends_at,e.id)
      from private.entitlements e left join private.payments pay on pay.id=e.payment_id
      where (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and internal.entitlement_usable(e.status,e.starts_at,e.ends_at) and exists(select 1 from private.current_account_access a where a.id=e.owner_id)
      and (e.source<>'retail_paid' or pay.status='complete')),'[]'::jsonb),
    'plan_admins',coalesce((select jsonb_agg(jsonb_build_object('entitlementId',e.id,'slotCapacity',e.slot_capacity,'expiresAt',e.ends_at,
      'admins',coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(internal.profile_public_name(pr.display_name),'Member'),
        'email',u.email) order by m.member_id) from private.entitlement_members m join auth.users u on u.id=m.member_id
        left join private.profiles pr on pr.account_id=m.member_id where m.entitlement_id=e.id),'[]'::jsonb)))
      from private.entitlements e join private.payments p on p.id=e.payment_id and p.status='complete'
      where e.owner_id=actor and e.source='retail_paid' and e.slot_capacity>1 and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
        -- a Multi-listing package's team belongs to the package (P4c), never to a grant
        and e.package_id is null),'[]'::jsonb),
    'sponsored_post_ids',coalesce((select jsonb_agg(a.post_id order by a.post_id) from private.post_activations a
      join private.entitlements e on e.id=a.entitlement_id and e.source='sponsorship'
      where a.owner_id=actor and a.released_at is null and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)),'[]'::jsonb),
    'addons',coalesce((select jsonb_agg(jsonb_build_object('post_id',p.id,
      'boost_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='boost' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp()),
      'featured_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='featured' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp()),
      'urgent_until',(select max(w.ends_at) from private.post_addon_windows w where w.post_id=p.id and w.kind='urgent' and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp())) order by p.id)
      from private.posts p where p.owner_id=actor and p.edit_of is null and exists(select 1 from private.post_addon_windows w
        where w.post_id=p.id and w.revoked_at is null and w.starts_at<=statement_timestamp() and w.ends_at>statement_timestamp())),'[]'::jsonb)) into result;
  perform internal.price_draft_actor();return result;
end$function$;
alter function internal.get_my_frontend_post_manager() owner to postgres;
revoke all on function internal.get_my_frontend_post_manager() from public;
grant execute on function internal.get_my_frontend_post_manager() to authenticated;

commit;
