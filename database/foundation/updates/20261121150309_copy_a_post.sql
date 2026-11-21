-- Copy a post (launch checklist item 17b, business tools plan section 3,
-- approved by the owner on 20 November 2026 with all 10 recommendations).
--
-- A member whose Multi-listing package is running makes a new Market listing
-- from one of their own listings, for example a second bakkie of the same
-- model. The copy is a draft post on the server; the website opens it in the
-- "Post an item" form, and it is submitted for review like any new post.
--
-- From this update:
-- 1. private.post_copies: which post a copy was made from (kept as a plain id,
--    so it stays after the source is deleted), the sha256 of the source's
--    photos at copy time, and the request that made it. Deleted with the copy.
-- 2. api.copy_my_post(post, request) (members): copies one of the caller's own
--    Market listings that was submitted at least once (not a draft, not held
--    by staff) into a new draft, only while the caller's Multi-listing package
--    runs (PT402, detail package_required). The draft is made by
--    internal.create_core_draft (its category rules and draft allowance: 5
--    plus the package's places, PT429) and gets the source's category,
--    title, description, area, price, details, which contact buttons to show
--    (never a number), the presentation fields, the photos and the listing
--    logo. The video and the video cover are not copied. Photos are the same
--    stored files: a file is deleted only when no post uses it any more
--    (internal.claim_media_cleanup), so deleting either post never removes
--    the other's photos. A repeated request answers with the same copy.
-- 3. Submitting a copy of a vehicle or property for review needs at least one
--    photo whose bytes (sha256) were not among the source's photos when it
--    was copied (owner decision, question 5): trigger copy_new_photo_required,
--    22023, detail copy_new_photo_required. The check uses the snapshot taken
--    at copy time, so deleting or changing the source changes nothing.
--    A copy uses a slot only when approved and counts towards the new-post
--    allowance like any new post (unchanged rules).
-- 4. api.get_frontend_staff_copy_facts(posts) (staff with queue:view): for
--    each given post under review that the caller has claimed, the post it
--    was copied from (id, title, status; status 'deleted' and no title once
--    it is gone) and the seller's other live posts
--    with a byte-identical photo (id, title, number of such photos, at most
--    10 posts). Posts not claimed by the caller are left out.
-- 5. Unfinished copies are deleted 14 days after their last change
--    (internal.purge_copy_drafts, run by internal.run_retention, which now
--    also returns 'copy_drafts'); never during a legal hold.
-- 6. The privacy export's posts rows gain copied_from.
-- 7. api.list_my_copy_drafts() (members): the caller's unfinished copies and
--    when each will be deleted (14 days after its last change), for the
--    Drafts tab on My posts.
--
-- Expand only: three new API commands, a new table, a trigger; run_retention
-- returns one more count and the export's posts rows one more field (both
-- read without a strict field list). No command, argument or grant changes.
-- ORDER: apply first, then merge. The website offers Copy only while
-- SHOW_POST_COPY is on (off until launch switch-on).
-- Read-only preflight: ../preflight/20261121150309_copy_a_post.check.sql.
-- Rollback: ../rollback/20261121150309_copy_a_post.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the two replaced functions have their reviewed body (or this
-- update's), and the new pieces are all absent or all present.
do $$
declare present integer;
begin
  select (to_regclass('private.post_copies') is not null)::integer
    + (to_regprocedure('internal.copy_my_post(uuid,uuid)') is not null)::integer
    + (to_regprocedure('api.copy_my_post(uuid,uuid)') is not null)::integer
    + (to_regprocedure('internal.copy_new_photo_guard()') is not null)::integer
    + (to_regprocedure('internal.get_frontend_staff_copy_facts(uuid[])') is not null)::integer
    + (to_regprocedure('api.get_frontend_staff_copy_facts(uuid[])') is not null)::integer
    + (to_regprocedure('internal.purge_copy_drafts(integer)') is not null)::integer
    + (to_regprocedure('internal.list_my_copy_drafts()') is not null)::integer
    + (to_regprocedure('api.list_my_copy_drafts()') is not null)::integer
  into present;
  if present not in (0, 9) then
    raise exception 'copy a post precondition: % of 9 new pieces exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.run_retention(integer)'))
      not in ('1d51acbc8fb435ac6f9b1f12a9020c2b', '27b281d704dc40daeeb3f97b88a839e9') then
    raise exception 'copy a post precondition: internal.run_retention is not the reviewed body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.frontend_privacy_export_data(uuid)'))
      not in ('e543b105fe264d5a683b5c570bf68cb5', '4aa0fa034c5c09e495530b5563ff3008') then
    raise exception 'copy a post precondition: internal.frontend_privacy_export_data is not the reviewed body' using errcode='55000';
  end if;
end$$;

-- 1. Which post a copy was made from, and its photos' bytes at that moment.
create table if not exists private.post_copies (
  post_id uuid primary key references private.posts(id) on delete cascade,
  -- A plain id: reviewers still see where a copy came from after the source goes.
  source_post_id uuid not null,
  source_photo_sha256 text[] not null,
  request_id uuid not null unique,
  created_at timestamptz not null default statement_timestamp(),
  check (source_post_id <> post_id)
);
alter table private.post_copies owner to postgres;
alter table private.post_copies enable row level security;
revoke all on private.post_copies from public, anon, authenticated, service_role;

-- 2. Copy one of my own listings into a new draft.
create or replace function internal.copy_my_post(p_post uuid, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); src private.posts; prior private.post_copies;
  copy_id uuid; answer jsonb;
begin
  if p_post is null or p_request is null then
    raise exception 'post and request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  -- A repeated request answers with the copy it made.
  select c.* into prior from private.post_copies c where c.request_id = p_request;
  if found then
    select jsonb_build_object('id', p.id, 'source_id', prior.source_post_id, 'status', p.status, 'revision', p.revision)
      into answer from private.posts p where p.id = prior.post_id and p.owner_id = actor;
    if answer is null or prior.source_post_id is distinct from p_post then
      raise exception 'copy request changed' using errcode='PT409'; end if;
    perform internal.price_draft_actor();
    return answer;
  end if;
  select * into src from private.posts p where p.id = p_post and p.owner_id = actor and p.edit_of is null for share;
  if not found then raise exception 'owned post unavailable' using errcode='42501'; end if;
  if src.kind <> 'listing' or src.status = 'draft' then
    raise exception 'only a submitted Market listing can be copied' using errcode='22023', detail='copy_source_invalid'; end if;
  if exists(select 1 from private.frontend_content_holds h where h.post_id = src.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode='PT423', detail='staff_visibility_hold'; end if;
  if not exists(select 1 from internal.slot_package_now(actor)) then
    raise exception 'copying a post needs a running Multi-listing package' using errcode='PT402', detail='package_required'; end if;
  -- The existing draft path: category contract, draft allowance, contact buttons.
  copy_id := (internal.create_core_draft(src.kind, src.area, src.category_key,
    coalesce((select jsonb_build_object('contact_channels', to_jsonb(c.channels)) from private.post_contacts c
      where c.post_id = src.id), '{}'::jsonb), src.activity_key)->>'id')::uuid;
  update private.posts set title = src.title, description = src.description, province_id = src.province_id,
    city_id = src.city_id, locality_label = src.locality_label where id = copy_id;
  update private.listing_details d set price_mode = s.price_mode, price_cents = s.price_cents,
    price_negotiable = s.price_negotiable, attributes = s.attributes, attributes_version = s.attributes_version
    from private.listing_details s where d.post_id = copy_id and s.post_id = src.id;
  -- Photos and the listing logo: the same stored files, never the video or its cover.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = src.id
      union select pm.object_id from private.post_presentation_media pm where pm.post_id = src.id)
    order by m.id for update;
  insert into private.post_media(post_id, object_id, purpose, position, focal_x, focal_y)
    select copy_id, pm.object_id, pm.purpose, pm.position, pm.focal_x, pm.focal_y
    from private.post_media pm join private.media_objects m on m.id = pm.object_id
    where pm.post_id = src.id and pm.purpose <> 'video' and m.state = 'ready';
  insert into private.post_presentations(post_id, data, contacts)
    select copy_id, d.data || jsonb_build_object('layout_width', null, 'layout_height', null), '{}'::jsonb
    from private.post_presentations d where d.post_id = src.id;
  insert into private.post_presentation_media(post_id, object_id, purpose, position)
    select copy_id, pm.object_id, pm.purpose, pm.position
    from private.post_presentation_media pm join private.media_objects m on m.id = pm.object_id
    where pm.post_id = src.id and pm.purpose = 'logo' and m.state = 'ready';
  insert into private.post_copies(post_id, source_post_id, source_photo_sha256, request_id)
    values (copy_id, src.id, array(select distinct m.sha256 from private.post_media pm
      join private.media_objects m on m.id = pm.object_id
      where pm.post_id = src.id and pm.purpose in ('cover', 'gallery') and m.sha256 is not null
      order by m.sha256), p_request);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return (select jsonb_build_object('id', p.id, 'source_id', src.id, 'status', p.status, 'revision', p.revision)
    from private.posts p where p.id = copy_id);
end;
$$;
alter function internal.copy_my_post(uuid, uuid) owner to postgres;

create or replace function api.copy_my_post(p_post uuid, p_request uuid)
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.copy_my_post(p_post, p_request);
$$;
alter function api.copy_my_post(uuid, uuid) owner to postgres;
revoke all on function internal.copy_my_post(uuid, uuid), api.copy_my_post(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.copy_my_post(uuid, uuid), api.copy_my_post(uuid, uuid) to authenticated;

-- 3. A copy of a vehicle or property needs one new photo before review.
create or replace function internal.copy_new_photo_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog'
as $$
begin
  -- Against the source's photos as they were when copied (the snapshot), so a
  -- later change to the source changes nothing.
  if new.category_key in ('vehicles', 'property')
    and exists(select 1 from private.post_copies c where c.post_id = new.id)
    and not exists(
      select 1 from private.post_media pm
      join private.media_objects m on m.id = pm.object_id
      join private.post_copies c on c.post_id = pm.post_id
      where pm.post_id = new.id and pm.purpose in ('cover', 'gallery') and m.kind = 'image' and m.sha256 is not null
        and m.sha256 <> all(c.source_photo_sha256)) then
    raise exception 'add at least one new photo of this item' using errcode='22023', detail='copy_new_photo_required';
  end if;
  return new;
end;
$$;
alter function internal.copy_new_photo_guard() owner to postgres;
revoke all on function internal.copy_new_photo_guard() from public, anon, authenticated, service_role;
create or replace trigger copy_new_photo_required before update of status on private.posts
  for each row when (new.status = 'pending_moderation' and old.status is distinct from new.status)
  execute function internal.copy_new_photo_guard();

-- 4. What a reviewer sees about a claimed post: its source and identical photos.
create or replace function internal.get_frontend_staff_copy_facts(p_posts uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.staff_actor('queue:view'); items jsonb;
begin
  if p_posts is null or cardinality(p_posts) > 25 then
    raise exception 'up to 25 posts' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'post_id', p.id,
      'copied_from', (select jsonb_build_object('id', c.source_post_id, 'title', s.title,
          'status', coalesce(s.status, 'deleted'))
        from private.post_copies c left join private.posts s on s.id = c.source_post_id where c.post_id = p.id),
      'same_photos', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'photos', o.n)
          order by o.n desc, o.id)
        from (select op.id, op.title, count(distinct m.sha256)::integer as n
          from private.post_media pm
          join private.media_objects m on m.id = pm.object_id
          join private.media_objects om on om.owner_id = p.owner_id and om.sha256 = m.sha256
          join private.post_media opm on opm.object_id = om.id and opm.purpose in ('cover', 'gallery')
          join private.posts op on op.id = opm.post_id
          where pm.post_id = p.id and pm.purpose in ('cover', 'gallery') and m.kind = 'image'
            and op.owner_id = p.owner_id and op.status = 'live' and op.id <> p.id
            and op.id is distinct from p.edit_of
          group by op.id, op.title
          order by n desc, op.id
          limit 10) o), '[]'::jsonb))
    order by p.id), '[]'::jsonb)
  into items
  from private.posts p
  where p.id = any(p_posts) and p.status = 'pending_moderation'
    and exists(select 1 from private.queue_claims q where q.post_id = p.id and q.claimed_by = actor
      and q.claim_expires_at > clock_timestamp());
  perform internal.staff_actor('queue:view');
  return jsonb_build_object('items', items);
end;
$$;
alter function internal.get_frontend_staff_copy_facts(uuid[]) owner to postgres;

create or replace function api.get_frontend_staff_copy_facts(p_posts uuid[])
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.get_frontend_staff_copy_facts(p_posts);
$$;
alter function api.get_frontend_staff_copy_facts(uuid[]) owner to postgres;
revoke all on function internal.get_frontend_staff_copy_facts(uuid[]), api.get_frontend_staff_copy_facts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function internal.get_frontend_staff_copy_facts(uuid[]), api.get_frontend_staff_copy_facts(uuid[])
  to authenticated;

-- 5. Unfinished copies go 14 days after their last change.
create or replace function internal.purge_copy_drafts(p_limit integer)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  delete from private.posts p where p.id in (
    select x.id from private.post_copies c join private.posts x on x.id = c.post_id
    where x.status = 'draft' and x.edit_of is null
      and x.content_updated_at < statement_timestamp() - interval '14 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id = x.owner_id and h.released_at is null)
    order by x.content_updated_at, x.id limit p_limit
    for update of x skip locked);
  get diagnostics n = row_count;
  return n;
end;
$$;
alter function internal.purge_copy_drafts(integer) owner to postgres;
revoke all on function internal.purge_copy_drafts(integer) from public, anon, authenticated, service_role;

-- 7. My unfinished copies, for the Drafts tab on My posts.
create or replace function internal.list_my_copy_drafts()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare actor uuid := internal.price_draft_actor(); items jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id,
      'deletes_at', p.content_updated_at + interval '14 days') order by p.content_updated_at desc, p.id), '[]'::jsonb)
    into items
  from private.post_copies c join private.posts p on p.id = c.post_id
  where p.owner_id = actor and p.status = 'draft' and p.edit_of is null;
  return jsonb_build_object('items', items);
end;
$$;
alter function internal.list_my_copy_drafts() owner to postgres;

create or replace function api.list_my_copy_drafts()
returns jsonb
language sql
set search_path to 'pg_catalog'
as $$
  select internal.list_my_copy_drafts();
$$;
alter function api.list_my_copy_drafts() owner to postgres;
revoke all on function internal.list_my_copy_drafts(), api.list_my_copy_drafts()
  from public, anon, authenticated, service_role;
grant execute on function internal.list_my_copy_drafts(), api.list_my_copy_drafts() to authenticated;

-- REPLACE: internal.run_retention (one more sweep, 'copy_drafts').
CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement(),
    'member_invitations',internal.purge_member_invitations(p_limit),
    'capture_handoffs',internal.purge_capture_handoffs(p_limit),
    'copy_drafts',internal.purge_copy_drafts(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

-- REPLACE: internal.frontend_privacy_export_data (posts rows gain copied_from).
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
      s.slug,d.data presentation,d.contacts contact_details,c.channels,cp.source_post_id copied_from
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      left join private.post_copies cp on cp.post_id=p.id
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
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number,
      r.kind,r.package_id,r.days_left,r.invoiced_days
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
    ('post_likes',$q$select l.post_id,l.created_at from (select post_id,created_at,id from private.post_likes
      where account_id=$1 order by created_at desc,id limit 2000) l$q$),
    ('post_likes_summary',$q$select count(*) total,min(created_at) first_at,max(created_at) last_at
      from private.post_likes where account_id=$1$q$),
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

commit;
