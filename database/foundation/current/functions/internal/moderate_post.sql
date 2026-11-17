-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
  -- The owner's subject lock first, as every owner command takes it, so that
  -- starting the free week below never waits for it beneath the post rows.
  perform internal.lock_evidence_subject(p.owner_id) from private.posts p where p.id = p_post_id;
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
    -- A rejected post does not use the free week.
    delete from private.intro_trial_requests r where r.post_id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    -- A post submitted without a plan waits for the free week: its 7 days
    -- start now, at approval.
    if post.kind <> 'event' and exists(select 1 from private.intro_trial_requests r where r.post_id = post.id)
      and not exists(select 1 from internal.post_funding(post.id)) then
      perform internal.start_intro_trial(post.id);
    end if;
    delete from private.intro_trial_requests r where r.post_id = post.id;
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
alter function internal.moderate_post(uuid,integer,text,text,text,uuid) owner to postgres;
revoke all on function internal.moderate_post(uuid,integer,text,text,text,uuid) from public;
grant execute on function internal.moderate_post(uuid,integer,text,text,text,uuid) to authenticated;
