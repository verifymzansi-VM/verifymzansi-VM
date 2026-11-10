-- Reviewed rollback for updates/20261110045944_intro_trial_at_first_approval.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and after the website release that reads
-- api.get_my_intro_trial has been reverted and deployed (the release checks
-- every API command it uses). Prefer a forward fix.
--
-- It restores the earlier bodies of the seven functions the update replaced,
-- byte for byte, and drops what it added. Verification then starts a 7-day
-- trial again: the every-minute job grants one to every fully verified member
-- whose identity holds none, within a minute.
--
-- Posts still waiting for the free week first get funding, so staff can still
-- approve them: a post that already has a slot keeps it; otherwise a free slot
-- the member has (chosen as internal.activate_post chooses) or, as before the
-- update, the member's 7-day trial granted now. If the member's verification is
-- no longer complete or the identity already holds a trial and there is no
-- free slot, the post stays in review unfunded and
-- cannot be approved; staff reject it and the member resubmits (applying the
-- update again lets it wait for an unused free week). Trials the update
-- withdrew stay withdrawn; their identities are free again, so the job grants
-- those members a new trial.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.intro_trial_requests') is null or to_regclass('private.intro_trial_rule') is null then
    raise exception 'rollback precondition: private.intro_trial_requests is missing' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.reconcile_intro_trials(integer)'::regprocedure)
      <>'41dcbbcf881420460765abac8cc67462' then
    raise exception 'rollback precondition: internal.reconcile_intro_trials is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.submit_post(uuid,integer)'::regprocedure)
      <>'56b073acfb683f53c9ae5639a3f0fa0e' then
    raise exception 'rollback precondition: internal.submit_post is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.moderate_post(uuid,integer,text,text,text,uuid)'::regprocedure)
      <>'1f127647b461014ddc3d6d6ef6d086c7' then
    raise exception 'rollback precondition: internal.moderate_post is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.consume_frontend_post_command(uuid)'::regprocedure)
      <>'d765f1d3ae821aadea6f73e5f524b784' then
    raise exception 'rollback precondition: internal.consume_frontend_post_command is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_posting_allowance(text)'::regprocedure)
      <>'b7d28c21cea2627ff8a1a5edec8fd69c' then
    raise exception 'rollback precondition: internal.get_my_frontend_posting_allowance is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_posting_allowance_v2(text)'::regprocedure)
      <>'5f289349861a6c403d88221437d6ff51' then
    raise exception 'rollback precondition: internal.get_my_frontend_posting_allowance_v2 is not the updated body' using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)
      <>'f0a000c6709e523e5aa2ef59af2f1948' then
    raise exception 'rollback precondition: internal.claim_supported_notification_outbox is not the updated body' using errcode='55000';
  end if;
end$$;

-- Posts waiting for the free week: the slot they have, a free slot of the
-- member, or a trial from now.
do $$
declare r record; granted jsonb; ent uuid; candidate private.entitlements;
begin
  for r in select q.post_id,q.owner_id,p.area from private.intro_trial_requests q
      join private.posts p on p.id=q.post_id and p.owner_id=q.owner_id
    where p.status='pending_moderation' order by q.owner_id,q.post_id
  loop
    perform internal.lock_verification_subject(r.owner_id);
    continue when exists(select 1 from internal.post_funding(r.post_id));
    ent:=null;
    for candidate in
      select e.* from private.entitlements e
      where internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
        and (e.area is null or e.area=r.area)
        and (e.owner_id=r.owner_id or exists(select 1 from private.entitlement_members m
          where m.entitlement_id=e.id and m.member_id=r.owner_id))
      order by e.ends_at,e.id
      for update
    loop
      continue when not internal.entitlement_for_post_eligible(candidate.id,r.post_id,r.owner_id)
        or (select count(*) from private.post_activations a where a.entitlement_id=candidate.id and a.released_at is null)
          >=candidate.slot_capacity
        or (candidate.activations_per_period is not null and (select count(*) from private.post_activations a
          where a.entitlement_id=candidate.id and a.activated_at>statement_timestamp()-make_interval(days=>candidate.activation_period_days))
          >=candidate.activations_per_period);
      ent:=candidate.id;
      exit;
    end loop;
    if ent is null then
      begin
        granted:=internal.grant_verified_intro_trial(r.owner_id,7);
      exception when sqlstate '42501' or sqlstate 'PT409' then granted:=null;
      end;
      if coalesce((granted->>'granted')::boolean,false) then ent:=(granted->>'entitlement_id')::uuid; end if;
    end if;
    continue when ent is null;
    update private.post_activations set released_at=statement_timestamp(),release_reason='entitlement_ended'
      where post_id=r.post_id and released_at is null;
    insert into private.post_activations(post_id,entitlement_id,owner_id) values(r.post_id,ent,r.owner_id);
  end loop;
end$$;

create or replace function internal.reconcile_intro_trials(p_limit integer default 20)
returns integer language plpgsql security definer set search_path=pg_catalog as $function$
declare target record; granted integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode='22023'; end if;
  for target in select u.id from private.current_account_access u
    join private.accepted_identity_facts f on f.owner_id=u.id and f.revoked_at is null
    where internal.current_verified_identity(u.id) is not null
      and exists(select 1 from private.verification_phone_proofs p where p.owner_id=u.id and p.revoked_at is null)
      and exists(select 1 from private.verification_localities l where l.owner_id=u.id)
      and not exists(select 1 from private.trial_identities t where t.identity_hmac=f.identity_hmac)
    order by u.id limit p_limit
  loop
    begin
      perform internal.grant_verified_intro_trial(target.id,7);
      granted:=granted+1;
    exception when sqlstate '42501' or sqlstate 'PT409' then null;
    end;
  end loop;
  return granted;
end;
$function$;
revoke all on function internal.reconcile_intro_trials(integer) from public,anon,authenticated,service_role;
grant execute on function internal.reconcile_intro_trials(integer) to service_role;

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  perform internal.price_draft_actor();
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions
    -- per 30 days. The 10 are counted from the kept submission ledger, so an
    -- event removed by the lifecycle job keeps its place; an owner deleting
    -- their own event returns it (internal.delete_post).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(distinct s.post_id) from private.event_submissions s where s.owner_id = actor
          and s.released_at is null and s.submitted_at > statement_timestamp() - interval '30 days' and s.post_id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  if post.kind = 'event' and post.edit_of is null then
    insert into private.event_submissions(owner_id, post_id, submitted_at) values (actor, post.id, statement_timestamp());
  end if;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$function$;
revoke all on function internal.submit_post(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function internal.submit_post(uuid,integer) to authenticated;

create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text, p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(post.id,true);
    perform internal.assert_posting_verification_ready(post.id,true);
  end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true);
    perform internal.assert_posting_verification_ready(coalesce(original_id,post.id),true);
  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$function$;
revoke all on function internal.moderate_post(uuid,integer,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.moderate_post(uuid,integer,text,text,text,uuid) to authenticated;

create or replace function internal.consume_frontend_post_command(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor uuid:=internal.price_draft_actor(); command private.frontend_post_commands; input jsonb;
  post private.posts; created jsonb; changed jsonb; terms jsonb; answer jsonb; trial jsonb; rev integer; target uuid; wants_edit boolean:=false;original_status text;
begin
  perform internal.lock_verification_subject(actor);
  perform internal.price_draft_actor();
  select * into command from private.frontend_post_commands where owner_id=actor and request_id=p_request for update;
  if not found then raise exception 'validated owner form required' using errcode='42501'; end if;
  if command.result is not null then return command.result; end if;
  if command.expires_at<=clock_timestamp() then raise exception 'form request expired' using errcode='PT409'; end if;
  input:=command.payload;
  if input->'presentation'->>'business_id' is not null and not exists(select 1 from private.posts b
    where b.id=(input->'presentation'->>'business_id')::uuid and b.kind='business' and b.owner_id=actor and b.edit_of is null) then
    raise exception 'linked business must belong to the current member' using errcode='42501'; end if;
  if input->>'target_id' is null then
      if input->>'terms_accepted' is distinct from 'true' then raise exception 'explicit posting consent required' using errcode='22023'; end if;
      perform internal.accept_posting_terms(input->'terms'->>'version',input->'terms'->>'document_hash');
    else
      if not exists(select 1 from private.posting_terms_current c join private.posting_terms_versions v on v.version=c.version
        join private.posting_terms_acceptances a on a.owner_id=actor and a.version=v.version and a.document_hash=v.document_hash
        where v.version=input->'terms'->>'version' and v.document_hash=input->'terms'->>'document_hash') then
        raise exception 'review and accept the current posting terms before editing' using errcode='PT409',detail='posting_terms_required'; end if;
    end if;
  target:=(input->>'target_id')::uuid;
  if target is not null then
    select * into post from private.posts where id=target and owner_id=actor for update;
    if not found or post.kind is distinct from input->'context'->>'kind' or post.area is distinct from input->'context'->>'area'
      or post.edit_of is not null then raise exception 'owned post unavailable' using errcode='42501'; end if;
    if post.revision is distinct from (input->>'expected_revision')::integer then raise exception 'post changed; reload before saving' using errcode='PT409'; end if;
    original_status:=post.status; if post.status='live' then
      created:=internal.create_post_edit(post.id,post.revision);target:=(created->>'id')::uuid;wants_edit:=true;
    elsif post.status in('expired','sold') then update private.posts set status='paused',revision=revision+1 where id=post.id returning * into post;
     elsif post.status not in('draft','rejected','paused') then
      raise exception 'post cannot be edited now' using errcode='PT409'; end if;
  else
    created:=internal.create_core_draft(input->'context'->>'kind',input->'context'->>'area',input->'context'->>'category',input->'detail',input->'context'->>'activity');
    target:=(created->>'id')::uuid;
  end if;
  select * into post from private.posts where id=target and owner_id=actor for update;
  if (post.category_key,post.activity_key) is distinct from (input->'context'->>'category',input->'context'->>'activity') then
    if not exists(select 1 from private.categories c where c.key=input->'context'->>'category' and c.kind=post.kind and c.area=post.area)
      or (input->'context'->>'activity' is not null and not exists(select 1 from private.category_activities a where a.category_key=input->'context'->>'category' and a.key=input->'context'->>'activity')) then
      raise exception 'category or activity unavailable' using errcode='22023'; end if;
    update private.posts set category_key=input->'context'->>'category',activity_key=input->'context'->>'activity',revision=revision+1 where id=post.id returning * into post;
  end if;
  changed:=internal.save_post_content(post.id,post.revision,input->'content');rev:=(changed->>'revision')::integer;
  if post.kind='listing' then
    terms:=internal.validated_listing_terms(post.category_key,input->'listing_terms');
    update private.listing_details set price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
      price_negotiable=(terms->>'price_negotiable')::boolean where post_id=post.id;
    update private.posts set revision=revision+1 where id=post.id returning revision into rev;
    changed:=internal.save_listing_attributes(post.id,rev,input->'attributes');rev:=(changed->>'revision')::integer;
  elsif post.kind='business' then
    changed:=internal.save_business_event_context(post.id,rev,jsonb_build_object('business_type',input->'business_type'));
    rev:=(changed->>'revision')::integer;
  elsif input ? 'target_id' then
    changed:=internal.save_business_event_context(post.id,rev,jsonb_build_object('event_window',(input->'detail')-'contact_channels'));
    rev:=(changed->>'revision')::integer;
  end if;
  if post.kind in('listing','event') then
    changed:=internal.set_post_contacts(post.id,rev,input->'detail'->'contact_channels');rev:=(changed->>'revision')::integer;
  end if;
  -- All references are journalled before submission. Extra venue/logo/poster
  -- images have separate bounded slots and do not consume gallery places.
  perform internal.save_frontend_post_presentation(post.id,input->'presentation',coalesce(input->'contacts','{}'::jsonb),input->'presentation_media');
  changed:=internal.set_post_media(post.id,rev,input->'media');rev:=(changed->>'revision')::integer;
  if input->>'target_id' is not null and not wants_edit then
       if original_status in('expired','sold') then update private.posts set status=original_status,revision=revision+1 where id=post.id returning revision into rev;end if;
       answer:=jsonb_build_object('id',post.id,'status',original_status,'revision',rev);
     else begin
    answer:=internal.submit_post(post.id,rev);
  exception when sqlstate 'PT402' then
    if post.kind='event' or wants_edit or input->>'trial_days' is null then raise; end if;
    trial:=internal.grant_verified_intro_trial(actor,(input->>'trial_days')::integer);
    if not coalesce((trial->>'granted')::boolean,false) then raise exception 'an active posting plan is required' using errcode='PT402'; end if;
    answer:=internal.submit_post(post.id,rev);
  end;
  end if; answer:=answer||jsonb_build_object('original_id',coalesce(post.edit_of,post.id),'edit_of',post.edit_of);
  update private.frontend_post_commands set result=answer,payload=null where owner_id=actor and request_id=p_request;
  perform internal.price_draft_actor();
  return answer;
end$function$;
revoke all on function internal.consume_frontend_post_command(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.consume_frontend_post_command(uuid) to authenticated;

create or replace function internal.get_my_frontend_posting_allowance(p_area text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor uuid:=internal.price_draft_actor();fingerprint text;claimed boolean;eligible boolean;result jsonb;
begin
  if p_area is null or p_area not in('market','business','tourism_events') then
    raise exception 'posting area required' using errcode='22023';end if;
  fingerprint:=internal.current_verified_identity(actor);
  claimed:=exists(select 1 from private.trial_identities t where t.owner_id=actor or t.identity_hmac=fingerprint);
  eligible:=not claimed and not exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp());
  -- Eligibility here is a display hint, including before identity review. The
  -- existing grant derives the verified identity and rechecks claims atomically.
  with usable as (
    select e.*,pay.snapshot from private.entitlements e left join private.payments pay on pay.id=e.payment_id
    where (e.area is null or e.area=p_area) and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)
      and (e.source<>'retail_paid' or (pay.status='complete' and pay.owner_id=e.owner_id))
  ) select jsonb_build_object(
    'account_id',actor,'profile_exists',exists(select 1 from private.profiles p where p.account_id=actor),
    'capacity',coalesce(sum(u.slot_capacity),0),
    'used',(select count(*) from private.post_activations a where a.entitlement_id in(select id from usable) and a.released_at is null),
    'max_photos',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),
    'max_videos',coalesce(max(u.max_videos),case when eligible then 1 else 0 end),
    'tier',case when count(*)=0 then 'free' else coalesce((select case when x.slot_capacity>1 then 'enterprise'
      when (x.snapshot->>'duration_days')::integer=30 then 'month' when (x.snapshot->>'duration_days')::integer=90 then 'quarter'
      when (x.snapshot->>'duration_days')::integer=180 then 'half_year' else 'active' end
      from usable x where x.source='retail_paid' order by (x.snapshot->>'duration_days')::integer desc,x.id limit 1),'active') end,
    'trial_ends_at',max(u.ends_at) filter(where u.source='intro_trial'),
    'trial_used',claimed,'trial_offer',jsonb_build_object('eligible',eligible,'sevenDayAvailable',eligible,
      'thirtyDayAvailable',eligible,'remaining',null,'launchEnabled',true,'shortDays',7,'longDays',30)
  ) into result from usable u;
  perform internal.price_draft_actor();return result;
end$function$;
revoke all on function internal.get_my_frontend_posting_allowance(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_posting_allowance(text) to authenticated;

create or replace function internal.get_my_frontend_posting_allowance_v2(p_area text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare actor uuid:=internal.price_draft_actor();fingerprint text;claimed boolean;eligible boolean;result jsonb;
begin
  if p_area is null or p_area not in('market','business','tourism_events') then
    raise exception 'posting area required' using errcode='22023';end if;
  fingerprint:=internal.current_verified_identity(actor);
  claimed:=exists(select 1 from private.trial_identities t where t.owner_id=actor or t.identity_hmac=fingerprint);
  eligible:=not claimed and not exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp());
  -- Eligibility here is a display hint, including before identity review. The
  -- existing grant derives the verified identity and rechecks claims atomically.
  with usable as (
    select e.*,pay.snapshot from private.entitlements e left join private.payments pay on pay.id=e.payment_id
    where (e.area is null or e.area=p_area) and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access a where a.id=e.owner_id)
      and (e.source<>'retail_paid' or (pay.status='complete' and pay.owner_id=e.owner_id))
  ) select jsonb_build_object(
    'account_id',actor,'profile_exists',exists(select 1 from private.profiles p where p.account_id=actor),
    'capacity',coalesce(sum(u.slot_capacity),0),
    'used',(select count(*) from private.post_activations a where a.entitlement_id in(select id from usable) and a.released_at is null),
    'creation_remaining',coalesce(sum(greatest(0,least(u.slot_capacity-a.active_count,
        coalesce(u.activations_per_period-a.period_count,u.slot_capacity)))),0),
    'max_photos',coalesce(max(u.max_photos),case when eligible then 10 else 0 end),
    'max_videos',coalesce(max(u.max_videos),case when eligible then 1 else 0 end),
    'tier',case when count(*)=0 then 'free' else coalesce((select case when x.slot_capacity>1 then 'enterprise'
      when (x.snapshot->>'duration_days')::integer=30 then 'month' when (x.snapshot->>'duration_days')::integer=90 then 'quarter'
      when (x.snapshot->>'duration_days')::integer=180 then 'half_year' else 'active' end
      from usable x where x.source='retail_paid' order by (x.snapshot->>'duration_days')::integer desc,x.id limit 1),'active') end,
    'trial_ends_at',max(u.ends_at) filter(where u.source='intro_trial'),
    'trial_used',claimed,'trial_offer',jsonb_build_object('eligible',eligible,'sevenDayAvailable',eligible,
      'thirtyDayAvailable',eligible,'remaining',null,'launchEnabled',true,'shortDays',7,'longDays',30)
  ) into result from usable u cross join lateral (
      select count(*) filter(where x.released_at is null) as active_count,
        count(*) filter(where x.activated_at>statement_timestamp()-make_interval(days=>u.activation_period_days)) as period_count
      from private.post_activations x where x.entitlement_id=u.id
    ) a;
  perform internal.price_draft_actor();return result;
end$function$;
revoke all on function internal.get_my_frontend_posting_allowance_v2(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_posting_allowance_v2(text) to authenticated;

create or replace function internal.claim_supported_notification_outbox(p_supported_kinds text[], p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare result jsonb;
begin
  if p_supported_kinds is null or cardinality(p_supported_kinds) not between 1 and 19 or coalesce(array_ndims(p_supported_kinds),0)<>1 then raise exception 'supported mail kinds required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_supported_kinds) k where k is null or k not in('payment_completed','payment_reversed','payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted','verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update','post_sold','post_kept')) then raise exception 'unsupported mail kind' using errcode='22023';end if;
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where kind=any(p_supported_kinds) and processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous and (o.kind not in('account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update') or not exists(select 1 from private.account_closures c where c.user_id=u.id)) then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at,'notice_reason',case when o.kind='account_warning' then (select r.reason from private.frontend_report_action_receipts r join private.frontend_account_warnings w on w.receipt_id=r.id where r.id=o.subject_id and w.account_id=o.owner_id) end,
    'deletes_at',p.deletes_at,
    'holds_slot',case when p.id is not null then exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) end) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end;
  return result;
end;
$function$;
revoke all on function internal.claim_supported_notification_outbox(text[],integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_supported_notification_outbox(text[],integer) to service_role;

drop function api.get_my_intro_trial();
drop function internal.get_my_intro_trial();
drop function internal.start_intro_trial(uuid);
drop function internal.queue_intro_trial(uuid);
drop function internal.intro_trial_waiting(uuid);
drop table private.intro_trial_requests;
drop table private.intro_trial_rule;

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.reconcile_intro_trials(integer)'::regprocedure)<>'f70eb13f358548e6866e6e6444e362a2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.submit_post(uuid,integer)'::regprocedure)<>'a34ca439aace1d529562d5c48bbcc125'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.moderate_post(uuid,integer,text,text,text,uuid)'::regprocedure)<>'b077eccbad927c17c6e6949fb398a974'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.consume_frontend_post_command(uuid)'::regprocedure)<>'48f301b07ef97551cc810c17c4512283'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_posting_allowance(text)'::regprocedure)<>'19d54312c05833a2403231868a41f3eb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_posting_allowance_v2(text)'::regprocedure)<>'e7d1b414d321c7aa2c84e49b25c59af1'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure)<>'039b1e461ee382e1e2ae7afc31f9d304' then
    raise exception 'free week rollback was not applied';
  end if;
end$$;
commit;
