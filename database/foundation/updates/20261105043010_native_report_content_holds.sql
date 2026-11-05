-- Distribution holds are independent of owner consent/funding and cannot be
-- removed by owner lifecycle commands. Each report keeps its own hold.
begin;
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('governor','content:hide',true),('admin','content:hide',true),
  ('governor','content:restore',true),('admin','content:restore',true);
alter table private.frontend_report_action_receipts add column target_post_revision integer check(target_post_revision>0);
create table private.frontend_post_hold_state(
  post_id uuid primary key references private.posts(id) on delete cascade,
  prior_status text not null check(prior_status in('live','paused')),
  prior_reason text,
  hidden_revision integer not null check(hidden_revision>0),
  content_changed boolean not null default false
);
create table private.frontend_content_holds(
  id uuid primary key references private.frontend_report_action_receipts(id) on delete cascade,
  post_id uuid not null references private.posts(id) on delete cascade,
  version integer not null default 1 check(version>0),
  released_at timestamptz,released_by uuid references auth.users(id) on delete set null,
  release_reason text check(release_reason is null or length(release_reason) between 5 and 500),
  restored boolean not null default false,
  check((released_at is null)=(release_reason is null))
);
create index frontend_content_holds_post_idx on private.frontend_content_holds(post_id) where released_at is null;
create index frontend_content_holds_releaser_idx on private.frontend_content_holds(released_by);
alter table private.frontend_post_hold_state enable row level security;
alter table private.frontend_content_holds enable row level security;
revoke all on private.frontend_post_hold_state,private.frontend_content_holds from public,anon,authenticated,service_role;

do $$declare body text;restorable text;begin
  body:=replace(pg_get_viewdef('private.public_eligible_posts'::regclass,true),E'\r\n',E'\n');
  if md5(body)<>'c74f94583c151b45cc86620869f04be4' then raise exception 'public distribution guard drift';end if;
  restorable:=replace(body,'p.status = ''live''::text','p.status IN (''live''::text,''paused''::text)');
  if restorable=body then raise exception 'restorable status anchor missing';end if;
  execute 'create view private.frontend_restorable_posts with(security_invoker=true) as '||restorable;
  execute 'create or replace view private.public_eligible_posts with(security_invoker=true) as select e.id from ('||rtrim(body,E';\n ')||') e
    where not exists(select 1 from private.frontend_content_holds h where h.post_id=e.id and h.released_at is null)';
end$$;
revoke all on private.frontend_restorable_posts,private.public_eligible_posts from public,anon,authenticated,service_role;

create function internal.guard_frontend_content_hold()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if new.status in('live','pending_moderation') and exists(select 1 from private.frontend_content_holds h where h.post_id=coalesce(new.edit_of,new.id) and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode='PT423',detail='staff_visibility_hold';
  end if;
  return new;
end$$;
revoke all on function internal.guard_frontend_content_hold() from public,anon,authenticated,service_role;
create trigger guard_frontend_content_hold before insert or update on private.posts for each row execute function internal.guard_frontend_content_hold();

-- The original report reader keeps its DTO. The new reader adds only the
-- represented target revision to the holder's existing private action fence.
create function internal.get_frontend_report_review_queue(p_area text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');result jsonb;items jsonb;
begin
  result:=internal.get_frontend_report_queue(p_area);
  select coalesce(jsonb_agg(case when x.value->'foundation'<>'null'::jsonb then
    jsonb_set(x.value,'{foundation}',x.value->'foundation'||jsonb_build_object('expectedPostRevision',p.revision)) else x.value end order by x.n),'[]'::jsonb)
    into items from jsonb_array_elements(result->'items') with ordinality x(value,n)
    left join private.reports r on r.id::text=x.value->>'id' left join private.posts p on p.id=r.post_id;
  perform internal.staff_actor('queue:view');return jsonb_set(result,'{items}',items);
end$$;
revoke all on function internal.get_frontend_report_review_queue(text) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_report_review_queue(text) to authenticated;
create function api.get_frontend_report_review_queue(p_area text default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_report_review_queue(p_area)$$;
revoke all on function api.get_frontend_report_review_queue(text) from public,anon,authenticated,service_role;
grant execute on function api.get_frontend_report_review_queue(text) to authenticated;

create function internal.execute_frontend_report_action_v2(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false,p_expected_post_revision integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;subject uuid;target uuid;post private.posts;r private.reports;q private.queue_claims;
  prior private.frontend_report_action_receipts;state private.frontend_post_hold_state;reason text;receipt uuid:=gen_random_uuid();answer jsonb;
begin
  if p_action is distinct from 'hide' then return internal.execute_frontend_report_action(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency);end if;
  actor:=internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  if p_expected_post_revision is null or p_expected_post_revision<1 or p_duration_days is not null or p_emergency is distinct from false then raise exception 'represented target revision required' using errcode='22023';end if;
  reason:=internal.validate_attribute_value('{"type":"string","minLength":10,"maxLength":500}'::jsonb,to_jsonb(p_reason)) #>> '{}';
  if reason is null or reason ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]' then raise exception 'valid hide reason required' using errcode='22023';end if;
  select subject_account_id,post_id into subject,target from private.reports where id=p_report;
  if not found or target is null then raise exception 'reported content is unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into post from private.posts where id=target for update;
  select * into r from private.reports where id=p_report for update;
  actor:=internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  if internal.queue_conflict(actor,null,p_report) or post.owner_id is distinct from subject then raise exception 'independent report subject required' using errcode='42501';end if;
  select * into prior from private.frontend_report_action_receipts x where x.report_id=p_report and x.expected_revision=p_expected_revision;
  if found then
    if prior.actor_id=actor and prior.action=p_action and prior.reason=reason and prior.target_post_revision=p_expected_post_revision
      and prior.claim_generation::text=p_claim_generation and prior.claim_nonce_digest=encode(sha256(convert_to(p_claim_nonce::text,'UTF8')),'hex')
      and prior.acknowledged_until>clock_timestamp() and r.status='resolved' and r.resolved_by=actor and r.resolution_note=reason
      and exists(select 1 from private.frontend_content_holds h where h.id=prior.id and h.released_at is null) then
      return jsonb_build_object('report_id',r.id,'action','hide','status','applied','reused',true);
    end if;
    raise exception 'hide receipt changed' using errcode='PT409';
  end if;
  if r.status<>'open' or r.revision is distinct from p_expected_revision or r.post_id is distinct from target
    or post.revision<>p_expected_post_revision or post.status not in('live','paused') or post.edit_of is not null or post.revision>=2147483647 then raise exception 'reviewed report or target changed' using errcode='PT409';end if;
  select * into q from private.queue_claims where report_id=r.id for update;
  perform internal.assert_queue_claim(q,actor,p_claim_generation,p_claim_nonce);
  select * into state from private.frontend_post_hold_state where post_id=post.id for update;
  if not found then
    insert into private.frontend_post_hold_state(post_id,prior_status,prior_reason,hidden_revision)
      values(post.id,post.status,post.status_reason,post.revision+1);
  else
    update private.frontend_post_hold_state set content_changed=content_changed or hidden_revision<>post.revision,hidden_revision=post.revision+1 where post_id=post.id;
  end if;
  update private.posts set status='paused',status_reason='staff_hidden',revision=revision+1 where id=post.id;
  update private.post_search_documents set is_visible=false where post_id=post.id;
  answer:=internal.resolve_report(r.id,p_claim_generation,p_claim_nonce,'resolved',reason);
  if answer->>'status' is distinct from 'resolved' then raise exception 'report closure not confirmed' using errcode='PT409';end if;
  insert into private.frontend_report_action_receipts(id,report_id,expected_revision,claim_generation,claim_nonce_digest,actor_id,action,reason,emergency,status,acknowledged_until,target_post_revision)
    values(receipt,r.id,p_expected_revision,q.claim_generation,encode(sha256(convert_to(q.claim_nonce::text,'UTF8')),'hex'),actor,'hide',reason,false,'applied',q.claim_expires_at,p_expected_post_revision);
  insert into private.frontend_content_holds(id,post_id) values(receipt,post.id);
  perform internal.staff_actor('content:hide');perform internal.staff_actor('report:resolve');
  return jsonb_build_object('report_id',r.id,'action','hide','status','applied');
end$$;
revoke all on function internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function internal.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) to authenticated;
create function api.execute_frontend_report_action_v2(p_report uuid,p_expected_revision integer,p_claim_generation text,p_claim_nonce uuid,p_action text,p_reason text,p_duration_days integer default null,p_emergency boolean default false,p_expected_post_revision integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.execute_frontend_report_action_v2(p_report,p_expected_revision,p_claim_generation,p_claim_nonce,p_action,p_reason,p_duration_days,p_emergency,p_expected_post_revision)$$;
revoke all on function api.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function api.execute_frontend_report_action_v2(uuid,integer,text,uuid,text,text,integer,boolean,integer) to authenticated;

create function internal.release_frontend_content_hold(p_hold uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('content:restore');target uuid;subject uuid;h private.frontend_content_holds;
  receipt private.frontend_report_action_receipts;r private.reports;post private.posts;state private.frontend_post_hold_state;reason text;did_restore boolean:=false;
begin
  reason:=internal.retention_reason(p_reason);
  select x.post_id,p.owner_id into target,subject from private.frontend_content_holds x join private.posts p on p.id=x.post_id where x.id=p_hold;
  if not found then raise exception 'content hold unavailable' using errcode='PT409';end if;
  perform internal.lock_verification_subject(subject);
  select * into post from private.posts where id=target for update;
  select * into h from private.frontend_content_holds where id=p_hold for update;
  select * into receipt from private.frontend_report_action_receipts where id=h.id;
  select * into r from private.reports where id=receipt.report_id;
  actor:=internal.staff_actor('content:restore');
  if actor=subject or actor=receipt.actor_id or actor=r.reporter_id then raise exception 'independent restoration reviewer required' using errcode='42501';end if;
  if h.released_at is not null then
    if h.released_by=actor and h.release_reason=reason and h.version=p_expected_version+1 then return jsonb_build_object('hold_id',h.id,'status','released','restored',h.restored,'reused',true);end if;
    raise exception 'content hold release changed' using errcode='PT409';
  end if;
  if h.version is distinct from p_expected_version or h.version>=2147483647 then raise exception 'represented content hold changed' using errcode='PT409';end if;
  update private.frontend_content_holds set version=version+1,released_at=clock_timestamp(),released_by=actor,release_reason=reason where id=h.id;
  if not exists(select 1 from private.frontend_content_holds x where x.post_id=target and x.released_at is null) then
    select * into state from private.frontend_post_hold_state where post_id=target for update;
    if post.status='paused' and post.status_reason='staff_hidden' and post.revision<2147483647 then
      if not state.content_changed and post.revision=state.hidden_revision and state.prior_status='live'
        and internal.current_verified_identity(subject) is not null and exists(select 1 from private.frontend_restorable_posts x where x.id=target) then
        update private.posts set status='live',status_reason=state.prior_reason,revision=revision+1 where id=target;
        perform internal.write_post_projection(target);did_restore:=true;
      else
        update private.posts set status_reason=case when state.prior_status='paused' then state.prior_reason else 'staff_review_cleared' end,revision=revision+1 where id=target;
      end if;
    end if;
    delete from private.frontend_post_hold_state where post_id=target;
  end if;
  update private.frontend_content_holds set restored=did_restore where id=h.id;
  perform internal.staff_actor('content:restore');
  return jsonb_build_object('hold_id',h.id,'status','released','restored',did_restore);
end$$;
revoke all on function internal.release_frontend_content_hold(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.release_frontend_content_hold(uuid,integer,text) to authenticated;
create function api.release_frontend_content_hold(p_hold uuid,p_expected_version integer,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.release_frontend_content_hold(p_hold,p_expected_version,p_reason)$$;
revoke all on function api.release_frontend_content_hold(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.release_frontend_content_hold(uuid,integer,text) to authenticated;
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text)'::regprocedure;
  if md5(body)<>'156451fc1a85340b5934595c142e16bf' then raise exception 'owner post action drift';end if;
  changed:=replace(body,'  perform internal.lock_verification_subject(actor);',
    '  perform internal.lock_verification_subject(actor);
  if p_action in(''reactivate'',''resubmit'') and exists(select 1 from private.frontend_content_holds h join private.posts p on p.id=h.post_id where p.id=p_post and p.owner_id=actor and h.released_at is null) then raise exception ''staff visibility hold requires independent release'' using errcode=''PT423'',detail=''staff_visibility_hold'';end if;');
  if changed=body then raise exception 'owner hold fence anchor missing';end if;
  execute format('create or replace function internal.execute_my_frontend_post_action(p_request uuid,p_post uuid,p_expected_revision integer,p_action text,p_kind text,p_area text) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;
notify pgrst,'reload schema';
commit;
