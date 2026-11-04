-- Owner commands preserve the selected buttons' flows. An unchanged approved
-- post may reactivate without a new review, while all current publication and
-- funding checks still run. Receipts resolve lost replies without replay.
begin;
create table private.frontend_post_action_receipts(
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,post_id uuid not null,expected_revision integer not null,
  action text not null check(action in('delete','resubmit','deactivate','mark_sold','reactivate')),
  kind text not null,area text not null,result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),primary key(owner_id,request_id)
);
create index frontend_post_action_retention_idx on private.frontend_post_action_receipts(created_at);
create table private.frontend_post_approval_snapshots(
  post_id uuid primary key references private.posts(id) on delete cascade,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),approved_at timestamptz not null
);
alter table private.frontend_post_action_receipts enable row level security;
alter table private.frontend_post_approval_snapshots enable row level security;
revoke all on private.frontend_post_action_receipts,private.frontend_post_approval_snapshots from public,anon,authenticated,service_role;
create function internal.frontend_post_approval_digest(p_id uuid)
returns text language sql stable security invoker set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object(
   'post',to_jsonb(p)-array['status','status_reason','revision','published_at','visible_until','submitted_at','content_updated_at','status_changed_at'],
   'listing',(select to_jsonb(d) from private.listing_details d where d.post_id=p.id),
   'business',(select to_jsonb(d) from private.business_details d where d.post_id=p.id),
   'event',(select to_jsonb(d) from private.event_details d where d.post_id=p.id),
   'contacts',(select to_jsonb(c) from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_media m where m.post_id=p.id),'[]'::jsonb),
   'presentation',(select to_jsonb(d) from private.post_presentations d where d.post_id=p.id),
   'presentation_media',coalesce((select jsonb_agg(to_jsonb(m) order by purpose,position) from private.post_presentation_media m where m.post_id=p.id),'[]'::jsonb)
 )::text,'UTF8')),'hex') from private.posts p where p.id=p_id;
$$;
revoke all on function internal.frontend_post_approval_digest(uuid) from public,anon,authenticated,service_role;
create function internal.capture_frontend_post_approval()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
  if new.decision='approve' and exists(select 1 from private.posts p where p.id=new.post_id and p.status='live' and p.edit_of is null) then
    insert into private.frontend_post_approval_snapshots(post_id,digest,approved_at)
      values(new.post_id,internal.frontend_post_approval_digest(new.post_id),new.decided_at)
      on conflict(post_id) do update set digest=excluded.digest,approved_at=excluded.approved_at;
  end if;return new;
end$$;
revoke all on function internal.capture_frontend_post_approval() from public,anon,authenticated,service_role;
create trigger capture_frontend_post_approval after insert on private.moderation_log for each row execute function internal.capture_frontend_post_approval();
-- Existing live canonical content with an actual approval log is already an
-- approved fact. Paused/unreviewed content is deliberately not backfilled.
insert into private.frontend_post_approval_snapshots(post_id,digest,approved_at)
 select p.id,internal.frontend_post_approval_digest(p.id),max(m.decided_at) from private.posts p
 join private.moderation_log m on m.post_id=p.id and m.decision='approve'
 where p.status='live' and p.edit_of is null group by p.id;

create function internal.execute_my_frontend_post_action(p_request uuid,p_post uuid,p_expected_revision integer,p_action text,p_kind text,p_area text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();post private.posts;prior private.frontend_post_action_receipts;
  result jsonb;submitted jsonb;funded_until timestamptz;current_digest text;unchanged boolean:=false;
begin
  if p_request is null or p_post is null or p_action is null or p_action not in('delete','resubmit','deactivate','mark_sold','reactivate')
    or p_kind is null or p_kind not in('listing','business','event') or p_area is null or p_area not in('market','business','tourism_events') then
    raise exception 'bounded owner action required' using errcode='22023';end if;
  perform internal.assert_post_revision(p_expected_revision);
  perform internal.lock_verification_subject(actor);
  select * into prior from private.frontend_post_action_receipts where owner_id=actor and request_id=p_request;
  if found then
    if (prior.post_id,prior.expected_revision,prior.action,prior.kind,prior.area) is distinct from (p_post,p_expected_revision,p_action,p_kind,p_area) then
      raise exception 'action receipt changed' using errcode='PT409';end if;
    perform internal.price_draft_actor();return prior.result;
  end if;
  select * into post from private.posts p where p.id=p_post and p.owner_id=actor for update;
  if not found or post.edit_of is not null or post.kind<>p_kind or post.area<>p_area then raise exception 'owned post unavailable' using errcode='42501';end if;
  if post.revision<>p_expected_revision then raise exception 'post changed; reload before continuing' using errcode='PT409';end if;
  if p_action='delete' then
    if exists(select 1 from private.legal_holds h where h.subject_id=actor and h.released_at is null) then raise exception 'post is held for review' using errcode='PT409';end if;
    perform internal.delete_post(post.id,post.revision);
    result:=jsonb_build_object('id',post.id,'status','deleted','success',true);
  elsif p_action in('deactivate','mark_sold') then
    result:=internal.set_post_state(post.id,post.revision,case p_action when 'deactivate' then 'pause' else 'sold' end)||jsonb_build_object('success',true);
  else
    if post.status not in('draft','rejected','paused','expired','sold') and not(post.status='live' and post.visible_until<=clock_timestamp()) then
      raise exception 'this post cannot be resubmitted now' using errcode='PT409';end if;
    if p_action='reactivate' then
      current_digest:=internal.frontend_post_approval_digest(post.id);
      unchanged:=post.status not in('draft','rejected') and exists(select 1 from private.frontend_post_approval_snapshots s where s.post_id=post.id and s.digest=current_digest);
    end if;
    if post.status in('expired','sold','live') then
      update private.posts set status='paused',revision=revision+1 where id=post.id returning * into post;
    end if;
    submitted:=internal.submit_post(post.id,post.revision);
    if p_action='reactivate' and unchanged then
      if internal.frontend_post_approval_digest(post.id) is distinct from current_digest then raise exception 'approved content changed' using errcode='PT409';end if;
      select f.funded_until into funded_until from internal.post_funding(post.id) f;
      if funded_until is null or funded_until<=clock_timestamp() then raise exception 'current posting funding required' using errcode='PT402';end if;
      update private.posts set status='live',status_reason=null,revision=revision+1,visible_until=funded_until,
        published_at=coalesce(published_at,statement_timestamp()) where id=post.id returning * into post;
      perform internal.write_post_projection(post.id);
      perform internal.assert_post_contacts_ready(post.id,false);
      perform internal.assert_posting_verification_ready(post.id,false);
      result:=jsonb_build_object('id',post.id,'status','live','revision',post.revision,'success',true);
    else result:=submitted||jsonb_build_object('success',true);end if;
  end if;
  perform internal.price_draft_actor();
  insert into private.frontend_post_action_receipts(owner_id,request_id,post_id,expected_revision,action,kind,area,result)
    values(actor,p_request,p_post,p_expected_revision,p_action,p_kind,p_area,result);
  return result;
end$$;
revoke all on function internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) to authenticated;
create function api.execute_my_frontend_post_action(p_request uuid,p_post uuid,p_expected_revision integer,p_action text,p_kind text,p_area text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.execute_my_frontend_post_action(p_request,p_post,p_expected_revision,p_action,p_kind,p_area)$$;
revoke all on function api.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function api.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) to authenticated;
create function internal.purge_frontend_post_actions(p_limit integer)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare candidate record;
begin
  for candidate in select owner_id,request_id from private.frontend_post_action_receipts where created_at<statement_timestamp()-interval '90 days' order by created_at limit p_limit loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue;end if;
    perform 1 from private.frontend_post_action_receipts where owner_id=candidate.owner_id and request_id=candidate.request_id for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null) then continue;end if;
    delete from private.frontend_post_action_receipts where owner_id=candidate.owner_id and request_id=candidate.request_id and created_at<statement_timestamp()-interval '90 days';
  end loop;
end$$;
revoke all on function internal.purge_frontend_post_actions(integer) from public,anon,authenticated,service_role;
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.run_retention(integer)'::regprocedure)<>'15c088ee772176745f757b12a5563acf' then raise exception 'owner action retention drift';end if;
  before:=replace(pg_get_functiondef('internal.run_retention(integer)'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'perform internal.purge_frontend_post_commands(p_limit);','perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit);');
  if before=after then raise exception 'owner action retention anchor missing';end if;execute after;
end$$;
notify pgrst,'reload schema';
commit;
