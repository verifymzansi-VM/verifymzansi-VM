-- Business review is bound to the current business owner and native
-- evidence case. Visit addresses, slots and artefacts are never public.
begin;
create table private.frontend_business_checks(
  id uuid primary key,
  business_id uuid not null references private.posts(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('seen','cipc')),
  status text not null default 'pending' check(status in('pending','info_requested','approved','rejected','withdrawn')),
  seen_method text check(seen_method in('video','visit')),
  visit_address text check(length(visit_address) between 5 and 300),
  available_slots text[],
  screenshots_consent_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  scheduled_for timestamptz,
  visit_report jsonb check(visit_report is null or jsonb_typeof(visit_report)='object'),
  report_by uuid references auth.users(id) on delete set null,
  report_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text check(length(review_note) between 1 and 1000),
  reason_code text check(length(reason_code) between 1 and 80),
  public_city text check(length(public_city) between 1 and 80),
  decided_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(id,owner_id) references private.evidence_cases(id,subject_id) on delete cascade,
  check(kind<>'seen' or (seen_method is not null and screenshots_consent_at is not null
    and available_slots is not null and cardinality(available_slots) between 1 and 3)),
  check(seen_method<>'visit' or visit_address is not null),
  check((status in('pending','info_requested'))=(decided_at is null)),
  check((status='approved')=(expires_at is not null)),
  check(revoked_at is null or status='withdrawn'),
  check(expires_at is null or expires_at>decided_at)
);
create unique index frontend_business_checks_open_idx on private.frontend_business_checks(business_id,kind) where status in('pending','info_requested');
create index frontend_business_checks_business_idx on private.frontend_business_checks(business_id,created_at desc);
create index frontend_business_checks_owner_idx on private.frontend_business_checks(owner_id);
create index frontend_business_checks_reviewer_idx on private.frontend_business_checks(reviewed_by);
create index frontend_business_checks_verifier_idx on private.frontend_business_checks(assigned_to);
create index frontend_business_checks_reporter_idx on private.frontend_business_checks(report_by);
alter table private.frontend_business_checks enable row level security;
revoke all on private.frontend_business_checks from public,anon,authenticated,service_role;
create table private.frontend_business_check_messages(
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references private.frontend_business_checks(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_role text not null check(author_role in('owner','staff')),
  body text not null check(length(body) between 1 and 2000),
  attachment_file_id uuid references private.evidence_artifacts(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
create index frontend_business_messages_case_idx on private.frontend_business_check_messages(check_id,created_at,id);
create index frontend_business_messages_author_idx on private.frontend_business_check_messages(author_id);
create unique index frontend_business_messages_attachment_idx on private.frontend_business_check_messages(attachment_file_id) where attachment_file_id is not null;
alter table private.frontend_business_check_messages enable row level security;
revoke all on private.frontend_business_check_messages from public,anon,authenticated,service_role;

create function internal.frontend_business_identity_reviewed(p_owner uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from private.accepted_identity_facts f join private.verification_identity_submissions s on s.id=f.submission_id
    join private.evidence_cases c on c.id=s.case_id and c.subject_id=p_owner
    where f.owner_id=p_owner and f.revoked_at is null and c.status='decided' and c.version=s.case_version+1
      and internal.verification_evidence_reviewed(s.id));
$$;
revoke all on function internal.frontend_business_identity_reviewed(uuid) from public,anon,authenticated,service_role;

create function internal.close_deleted_frontend_business_check()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform internal.lock_verification_subject(old.owner_id);
  update private.evidence_cases set status='closed',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1
    where id=old.id and status='open';
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),clock_timestamp()+interval '30 days')
    where case_id=old.id and state='clean';
  return old;
end$$;
revoke all on function internal.close_deleted_frontend_business_check() from public,anon,authenticated,service_role;
create trigger close_deleted_frontend_business_check after delete on private.frontend_business_checks
  for each row execute function internal.close_deleted_frontend_business_check();

-- The upload journal continues to own the object and its retention. The
-- sidecar binds the visit photo to the assigned verifier who reserved it.
create table private.frontend_business_seen_photos(
  artifact_id uuid primary key references private.evidence_artifacts(id) on delete cascade,
  check_id uuid not null references private.frontend_business_checks(id) on delete cascade,
  verifier_id uuid references auth.users(id) on delete set null,
  content_digest text not null check(content_digest ~ '^[0-9a-f]{64}$'),
  mime text not null check(mime in('image/jpeg','image/png','image/webp')),
  latitude numeric(7,5) check(latitude between -90 and 90),
  longitude numeric(8,5) check(longitude between -180 and 180),
  created_at timestamptz not null default clock_timestamp(),
  unique(check_id,content_digest)
);
create index frontend_business_seen_photos_verifier_idx on private.frontend_business_seen_photos(verifier_id);
alter table private.frontend_business_seen_photos enable row level security;
revoke all on private.frontend_business_seen_photos from public,anon,authenticated,service_role;
alter table private.evidence_artifacts drop constraint evidence_artifacts_purpose_check;
alter table private.evidence_artifacts add constraint evidence_artifacts_purpose_check
  check(purpose in('id_front','id_back','selfie','proof_of_address','registration','business_visit_photo','business_reply_attachment'));
create table private.frontend_business_reply_files(
  artifact_id uuid primary key references private.evidence_artifacts(id) on delete cascade,
  check_id uuid not null references private.frontend_business_checks(id) on delete cascade,
  content_digest text not null check(content_digest ~ '^[0-9a-f]{64}$'),
  mime text not null check(mime in('image/jpeg','image/png','image/webp','application/pdf')),
  unique(check_id,content_digest)
);
alter table private.frontend_business_reply_files enable row level security;
revoke all on private.frontend_business_reply_files from public,anon,authenticated,service_role;
create view private.frontend_business_seen_files with(security_invoker=true) as
  select artifact_id,check_id,content_digest,mime,'visit_photo'::text kind from private.frontend_business_seen_photos
  union all select f.artifact_id,f.check_id,f.content_digest,f.mime,'message_attachment'::text from private.frontend_business_reply_files f
    join private.frontend_business_check_messages m on m.attachment_file_id=f.artifact_id and m.check_id=f.check_id;
revoke all on private.frontend_business_seen_files from public,anon,authenticated,service_role;

create function internal.request_frontend_business_seen(p_business uuid,p_method text,p_slots text[],p_consent boolean,p_address text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();post private.posts;x private.frontend_business_checks;
  requested uuid;address text;slots text[];now_at timestamptz;
begin
  if p_method is null or p_method not in('video','visit') or p_consent is distinct from true or p_slots is null
    or cardinality(p_slots) not between 1 and 3 or array_ndims(p_slots)<>1
    then raise exception 'method, availability and screenshot consent required' using errcode='22023';end if;
  if p_method='visit' then address:=internal.privacy_text(p_address,5,300);end if;
  select array_agg(internal.privacy_text(s.slot,3,80) order by s.n) into slots from unnest(p_slots) with ordinality s(slot,n);
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  select * into post from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business'
    and p.edit_of is null and p.status not in('archived','sold') for update;
  if not found then raise exception 'business unavailable for this member' using errcode='PT404';end if;
  if not internal.frontend_business_identity_reviewed(actor) then raise exception 'reviewed owner identity required' using errcode='42501';end if;
  now_at:=clock_timestamp();
  select * into x from private.frontend_business_checks c where c.business_id=post.id and c.kind='seen' and c.status in('pending','info_requested');
  if found then
    if x.owner_id=actor and x.status='pending' and x.seen_method=p_method and x.available_slots=slots
      and x.visit_address is not distinct from address and x.created_at>now_at-interval '10 minutes'
      then return jsonb_build_object('caseId',x.id,'status','pending','reused',true);end if;
    raise exception 'this business already has a check in progress' using errcode='PT409';
  end if;
  insert into private.evidence_cases(subject_id,kind) values(actor,'business') returning id into requested;
  insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,visit_address,available_slots,screenshots_consent_at,created_at,updated_at)
    values(requested,post.id,actor,'seen',p_method,address,slots,now_at,now_at,now_at);
  perform internal.price_draft_actor();
  return jsonb_build_object('caseId',requested,'status','pending');
end$$;
create function api.request_frontend_business_seen(p_business uuid,p_method text,p_slots text[],p_consent boolean,p_address text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.request_frontend_business_seen(p_business,p_method,p_slots,p_consent,p_address)$$;

create function internal.withdraw_frontend_business_check(p_business uuid,p_case uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();now_at timestamptz;current_case private.frontend_business_checks;
begin
  perform internal.lock_verification_subject(actor);
  perform 1 from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' for update;
  if not found then raise exception 'business unavailable for this member' using errcode='PT404';end if;
  perform 1 from private.evidence_cases e where e.id=p_case and e.subject_id=actor and e.status='open' for update;
  if not found then raise exception 'no open check' using errcode='PT409';end if;
  select * into current_case from private.frontend_business_checks c
    where c.id=p_case and c.business_id=p_business and c.owner_id=actor and c.status in('pending','info_requested') for update;
  if not found then raise exception 'no open check' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  update private.evidence_cases set status='closed',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=p_case;
  update private.frontend_business_checks set status='withdrawn',decided_at=now_at,updated_at=now_at where id=p_case;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=p_case and state='clean';
  perform internal.price_draft_actor();return jsonb_build_object('ok',true);
end$$;
create function api.withdraw_frontend_business_check(p_business uuid,p_case uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.withdraw_frontend_business_check(p_business,p_case)$$;

create function internal.get_my_frontend_business_checks(p_business uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();post private.posts;result jsonb;
begin
  select * into post from private.posts p where p.id=p_business and p.owner_id=actor and p.kind='business' and p.edit_of is null;
  if not found then raise exception 'business unavailable for this member' using errcode='PT404';end if;
  select jsonb_build_object('business',jsonb_build_object('id',post.id,'name',post.title),
    'stickers',jsonb_build_object('idReviewed',internal.frontend_business_identity_reviewed(actor),'cipc',null,
      'seen',(select jsonb_build_object('verifiedAt',c.decided_at,'expiresAt',c.expires_at,'method',c.seen_method,'city',c.public_city)
        from (select * from private.frontend_business_checks x where x.business_id=post.id and x.owner_id=actor and x.kind='seen'
          and (x.status='approved' or x.revoked_at is not null) order by x.decided_at desc,x.id desc limit 1)c
        where c.status='approved' and c.expires_at>clock_timestamp() and internal.frontend_business_identity_reviewed(actor))),
    'cases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'route',null,
      'registrationNumber',null,'reasonCode',c.reason_code,'note',c.review_note,'createdAt',c.created_at,'decidedAt',c.decided_at,
      'expiresAt',c.expires_at,'seenMethod',c.seen_method,'seenScheduledFor',c.scheduled_for,'representative',null,
      'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',case m.author_role when 'owner' then 'You' else 'VerifyMzansi team' end,
        'mine',m.author_role='owner','body',m.body,'createdAt',m.created_at) order by m.created_at,m.id)
        from (select * from private.frontend_business_check_messages where check_id=c.id order by created_at desc,id desc limit 100)m),'[]'::jsonb))
      order by c.created_at desc,c.id desc) from (
        select * from private.frontend_business_checks x where x.business_id=post.id and x.owner_id=actor
          order by x.created_at desc,x.id desc limit 20)c),'[]'::jsonb),'linkable','[]'::jsonb) into result;
  perform internal.price_draft_actor();return result;
end$$;
create function api.get_my_frontend_business_checks(p_business uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_business_checks(p_business)$$;

create function internal.lock_frontend_seen_case(p_case uuid)
returns private.frontend_business_checks language plpgsql security invoker set search_path=pg_catalog as $$
declare subject uuid;x private.frontend_business_checks;
begin
  select owner_id into subject from private.frontend_business_checks where id=p_case;
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  perform p.id from private.posts p join private.frontend_business_checks b on b.business_id=p.id
    where b.id=p_case and p.owner_id=subject and p.kind='business' for update of p;
  if not found then raise exception 'business owner changed' using errcode='PT409';end if;
  perform 1 from private.evidence_cases e where e.id=p_case and e.subject_id=subject and e.status='open' for update;
  if not found then raise exception 'business check is no longer open' using errcode='PT409';end if;
  select * into x from private.frontend_business_checks c where c.id=p_case and c.kind='seen' and c.status='pending' for update;
  if not found then raise exception 'seen check is no longer pending' using errcode='PT409';end if;
  return x;
end$$;
revoke all on function internal.lock_frontend_seen_case(uuid) from public,anon,authenticated,service_role;

create function internal.reserve_frontend_seen_photo(p_case uuid,p_digest text,p_lat numeric default null,p_lng numeric default null,p_mime text default 'image/jpeg')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;art private.evidence_artifacts;existing private.frontend_business_seen_photos;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_lat not between -90 and 90 or p_lng not between -180 and 180
    or p_mime is null or p_mime not in('image/jpeg','image/png','image/webp')
    then raise exception 'valid visit photograph required' using errcode='22023';end if;
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');
  if x.owner_id=actor or x.assigned_to is distinct from actor or x.visit_report is not null
    then raise exception 'only the assigned verifier can upload before reporting' using errcode='42501';end if;
  select * into existing from private.frontend_business_seen_photos p where p.check_id=x.id and p.content_digest=p_digest;
  if found then
    select * into art from private.evidence_artifacts where id=existing.artifact_id;
    if existing.verifier_id is distinct from actor or existing.mime<>p_mime or art.state not in('intent','uploaded','clean')
      then raise exception 'photo upload no longer available' using errcode='PT409';end if;
    return jsonb_build_object('artifact_id',art.id,'owner_id',x.owner_id,'completed',art.state='clean');
  end if;
  if (select count(*) from private.frontend_business_seen_photos where check_id=x.id)>=12 then raise exception 'visit photo limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,x.owner_id,'business_visit_photo','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_business_seen_photos(artifact_id,check_id,verifier_id,content_digest,mime,latitude,longitude)
    values(art.id,x.id,actor,p_digest,p_mime,case when x.seen_method='visit' then p_lat end,case when x.seen_method='visit' then p_lng end);
  return jsonb_build_object('artifact_id',art.id,'owner_id',x.owner_id,'completed',false);
end$$;
create function api.reserve_frontend_seen_photo(p_case uuid,p_digest text,p_lat numeric default null,p_lng numeric default null,p_mime text default 'image/jpeg')
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reserve_frontend_seen_photo(p_case,p_digest,p_lat,p_lng,p_mime)$$;

create function internal.get_frontend_seen_photo_receipt(p_case uuid,p_artifact uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;p private.frontend_business_seen_photos;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');
  if x.assigned_to is distinct from actor or x.owner_id=actor then raise exception 'current assigned verifier required' using errcode='42501';end if;
  select photo.* into p from private.frontend_business_seen_photos photo join private.evidence_artifacts a on a.id=photo.artifact_id
    where photo.check_id=x.id and photo.artifact_id=p_artifact and photo.verifier_id=actor and a.state='clean' and a.content_sha256=photo.content_digest;
  if not found then raise exception 'photo storage could not be confirmed' using errcode='PT409';end if;
  return jsonb_build_object('fileId',p.artifact_id,'by',actor,'takenAt',p.created_at,'lat',p.latitude,'lng',p.longitude);
end$$;
create function api.get_frontend_seen_photo_receipt(p_case uuid,p_artifact uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_seen_photo_receipt(p_case,p_artifact)$$;

create function internal.schedule_frontend_seen_check(p_case uuid,p_expected timestamptz,p_scheduled timestamptz,p_generation text default null,p_nonce uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;c private.evidence_cases;now_at timestamptz;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');now_at:=clock_timestamp();
  if x.owner_id=actor then raise exception 'self review is not allowed' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.visit_report is not null then raise exception 'business check changed' using errcode='PT409';end if;
  if p_scheduled is null or not isfinite(p_scheduled) or p_scheduled<now_at-interval '1 hour' then raise exception 'choose a future check time' using errcode='22023';end if;
  if x.assigned_to is distinct from actor then
    if x.assigned_to is not null then perform internal.staff_actor('decision:approve');end if;
    select * into c from private.evidence_cases where id=x.id;
    perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  end if;
  update private.frontend_business_checks set assigned_to=actor,scheduled_for=p_scheduled,updated_at=now_at where id=x.id;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('ok',true,'updatedAt',now_at);
end$$;
create function api.schedule_frontend_seen_check(p_case uuid,p_expected timestamptz,p_scheduled timestamptz,p_generation text default null,p_nonce uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.schedule_frontend_seen_check(p_case,p_expected,p_scheduled,p_generation,p_nonce)$$;

create function internal.report_frontend_seen_check(p_case uuid,p_expected timestamptz,p_report jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('case:claim');x private.frontend_business_checks;now_at timestamptz;products text;notes text;
begin
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('case:claim');now_at:=clock_timestamp();
  if x.assigned_to is distinct from actor or x.owner_id=actor then raise exception 'assigned verifier required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected or x.visit_report is not null then raise exception 'business check changed' using errcode='PT409';end if;
  if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>8000
    or exists(select 1 from jsonb_object_keys(p_report) k where k not in('outcome','identityConfirmed','signage','productsSeen','premisesType','notes','city'))
    or coalesce(p_report->>'outcome','') not in('seen','not_confirmed')
    or coalesce(p_report->>'premisesType','') not in('shop','home_based','market_stall','mobile_service','online_with_stock','office')
    or jsonb_typeof(p_report->'identityConfirmed') is distinct from 'boolean' or jsonb_typeof(p_report->'signage') is distinct from 'boolean'
    then raise exception 'valid business visit report required' using errcode='22023';end if;
  products:=internal.privacy_text(p_report->>'productsSeen',3,500);
  if nullif(p_report->>'notes','') is not null then notes:=internal.privacy_text(p_report->>'notes',1,1000);end if;
  if p_report->>'outcome'='seen' and (select count(*) from private.frontend_business_seen_photos p join private.evidence_artifacts a on a.id=p.artifact_id
    where p.check_id=x.id and p.verifier_id=actor and a.state='clean' and p.content_digest=a.content_sha256)<3
    then raise exception 'three distinct confirmed photographs required' using errcode='PT409';end if;
  update private.frontend_business_checks set visit_report=jsonb_build_object('outcome',p_report->>'outcome','identityConfirmed',p_report->'identityConfirmed',
    'signage',p_report->'signage','productsSeen',products,'premisesType',p_report->>'premisesType','notes',notes,
    'city',case when p_report->>'city' is not null then internal.privacy_text(p_report->>'city',1,80) end),
    report_by=actor,report_at=now_at,updated_at=now_at where id=x.id;
  update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  perform internal.staff_actor('case:claim');
  return jsonb_build_object('ok',true,'updatedAt',now_at);
end$$;
create function api.report_frontend_seen_check(p_case uuid,p_expected timestamptz,p_report jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.report_frontend_seen_check(p_case,p_expected,p_report)$$;

create function internal.decide_frontend_seen_check(p_case uuid,p_expected timestamptz,p_action text,p_generation text,p_nonce uuid,p_note text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('verification:decide_routine');x private.frontend_business_checks;c private.evidence_cases;
  now_at timestamptz;new_status text;notes text;city text;
begin
  if p_action is null or p_action not in('approve','reject','request_info') or (p_reason is not null and p_reason !~ '^[a-z0-9_]{1,80}$')
    then raise exception 'valid seen decision required' using errcode='22023';end if;
  if nullif(btrim(p_note),'') is not null then notes:=internal.privacy_text(p_note,1,1000);end if;
  x:=internal.lock_frontend_seen_case(p_case);actor:=internal.staff_actor('verification:decide_routine');now_at:=clock_timestamp();
  if actor=x.owner_id or (p_action='approve' and actor in(x.assigned_to,x.report_by))
    then raise exception 'an independent staff reviewer is required' using errcode='42501';end if;
  if x.updated_at is distinct from p_expected then raise exception 'business check changed' using errcode='PT409';end if;
  select * into c from private.evidence_cases where id=x.id;
  perform internal.assert_evidence_claim(c,actor,p_generation,p_nonce);
  if p_action='request_info' then
    notes:=internal.privacy_text(p_note,1,1000);
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',notes);
    update private.frontend_business_checks set status='info_requested',updated_at=now_at where id=x.id;
    update private.evidence_cases set claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
    perform internal.staff_actor('verification:decide_routine');
    return jsonb_build_object('caseId',x.id,'status','info_requested');
  end if;
  if p_action='approve' then
    if x.report_by is null or x.report_by is distinct from x.assigned_to
      or x.visit_report->>'outcome' is distinct from 'seen' or x.visit_report->>'identityConfirmed' is distinct from 'true'
      or not internal.frontend_business_identity_reviewed(x.owner_id)
      or (select count(*) from private.frontend_business_seen_photos p join private.evidence_artifacts a on a.id=p.artifact_id
        where p.check_id=x.id and p.verifier_id=x.report_by and a.state='clean' and a.content_sha256=p.content_digest)<3
      then raise exception 'confirmed identity and three current photographs required' using errcode='PT409';end if;
    if x.seen_method='visit' then
      select coalesce((select y.label from private.cities y where y.province_id=p.province_id
          and lower(y.label)=lower(x.visit_report->>'city') order by y.id limit 1),city_ref.label)
      into city from private.posts p left join private.cities city_ref on city_ref.id=p.city_id where p.id=x.business_id;
    end if;
    new_status:='approved';
  else new_status:='rejected';end if;
  update private.frontend_business_checks set status=new_status,review_note=notes,reviewed_by=actor,public_city=city,reason_code=p_reason,
    decided_at=now_at,updated_at=now_at,expires_at=case when new_status='approved' then now_at+interval '365 days' end where id=x.id;
  update private.evidence_cases set status='decided',claimed_by=null,claim_expires_at=null,claim_nonce=null,version=version+1 where id=x.id;
  update private.evidence_artifacts set retain_until=least(coalesce(retain_until,'infinity'::timestamptz),now_at+interval '30 days')
    where case_id=x.id and state='clean';
  perform internal.staff_actor('verification:decide_routine');
  return jsonb_build_object('caseId',x.id,'status',new_status);
end$$;
create function api.decide_frontend_seen_check(p_case uuid,p_expected timestamptz,p_action text,p_generation text,p_nonce uuid,p_note text default null,p_reason text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.decide_frontend_seen_check(p_case,p_expected,p_action,p_generation,p_nonce,p_note,p_reason)$$;

create function internal.revoke_frontend_seen_check(p_case uuid,p_expected timestamptz,p_note text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('decision:approve');subject uuid;x private.frontend_business_checks;now_at timestamptz;notes text;
begin
  notes:=internal.privacy_text(p_note,5,1000);
  if p_reason is null or p_reason !~ '^[a-z0-9_]{1,80}$' then raise exception 'a reason for revocation is required' using errcode='22023';end if;
  select owner_id into subject from private.frontend_business_checks where id=p_case;
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('decision:approve');
  if actor=subject then raise exception 'independent revocation required' using errcode='42501';end if;
  select * into x from private.frontend_business_checks where id=p_case and kind='seen' for update;
  if not found or x.status<>'approved' or x.updated_at is distinct from p_expected then raise exception 'business check changed' using errcode='PT409';end if;
  now_at:=clock_timestamp();
  update private.frontend_business_checks set status='withdrawn',expires_at=null,revoked_at=now_at,review_note=notes,reason_code=p_reason,updated_at=now_at where id=x.id;
  insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',notes);
  perform internal.staff_actor('decision:approve');
  return jsonb_build_object('caseId',x.id,'status','withdrawn');
end$$;
create function api.revoke_frontend_seen_check(p_case uuid,p_expected timestamptz,p_note text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.revoke_frontend_seen_check(p_case,p_expected,p_note,p_reason)$$;

create function internal.get_public_frontend_business_seen(p_post_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_post_ids is null or cardinality(p_post_ids)>100 or coalesce(array_ndims(p_post_ids),1)<>1
    then raise exception 'bounded represented businesses required' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('business_id',x.business_id,'verified_at',x.decided_at,
    'expires_at',x.expires_at,'method',x.seen_method,'city',x.public_city) order by x.business_id),'[]'::jsonb) into result from (
      select distinct on(c.business_id) c.* from private.frontend_business_checks c
      join private.posts p on p.id=c.business_id and p.owner_id=c.owner_id and p.kind='business'
      join private.public_eligible_posts eligible on eligible.id=p.id
      where c.business_id=any(p_post_ids) and c.kind='seen' and (c.status='approved' or c.revoked_at is not null)
      order by c.business_id,c.decided_at desc,c.id desc)x
    where x.status='approved' and x.expires_at>statement_timestamp() and internal.frontend_business_identity_reviewed(x.owner_id);
  return result;
end$$;
create function api.get_public_frontend_business_seen(p_post_ids uuid[])
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select internal.get_public_frontend_business_seen(p_post_ids)$$;
revoke all on function internal.get_public_frontend_business_seen(uuid[]),api.get_public_frontend_business_seen(uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_frontend_business_seen(uuid[]),api.get_public_frontend_business_seen(uuid[]) to anon,authenticated;

create function internal.get_frontend_seen_queue(p_tab text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;
begin
  if p_tab is null or p_tab not in('review','representatives','visits','conflicts','renewals','exceptions','waiting','decided')
    then raise exception 'valid business review queue required' using errcode='22023';end if;
  with cases as (
    select x.*,p.title as business_name,pr.display_name as owner_name,
      case when x.status='info_requested' then 'waiting' when x.status='pending' then 'visits' else 'decided' end tab,
      e.claimed_by=actor and e.claim_expires_at>clock_timestamp() as mine
    from private.frontend_business_checks x join private.posts p on p.id=x.business_id
    join private.evidence_cases e on e.id=x.id left join private.profiles pr on pr.account_id=x.owner_id
    where x.kind='seen' and x.owner_id<>actor
  )
  select jsonb_build_object('actor_id',actor,
    'counts',jsonb_build_object('visits',(select count(*) from cases where tab='visits'),
      'waiting',(select count(*) from cases where tab='waiting'),'decided',null,
      'review',0,'representatives',0,'conflicts',0,'renewals',0,'exceptions',0),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind','seen','route',null,'status',x.status,
      'businessId',x.business_id,'businessName',coalesce(x.business_name,'Business'),'ownerName',coalesce(x.owner_name,'Member'),
      'registrationNumber',null,'red',0,'amber',0,'createdAt',x.created_at,'updatedAt',x.updated_at,
      'exceptionPending',false,'conflict',false,'renewal',false) order by x.sort_at,x.id)
      from (select c.*,case when p_tab='decided' then -extract(epoch from c.decided_at) else extract(epoch from c.created_at) end sort_at
        from cases c where c.tab=p_tab or (p_tab<>'decided' and c.tab<>'decided' and c.mine)
        order by sort_at,id limit 200)x),'[]'::jsonb)) into answer;
  perform internal.staff_actor('queue:view');return answer;
end$$;
create function api.get_frontend_seen_queue(p_tab text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_seen_queue(p_tab)$$;

create function internal.get_frontend_seen_case(p_case uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;x private.frontend_business_checks;ec private.evidence_cases;private_read boolean:=false;ids uuid[];
begin
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  select * into ec from private.evidence_cases where id=x.id;
  if actor<>x.owner_id and (actor=x.assigned_to or actor=x.reviewed_by or
    (ec.status='open' and ec.claimed_by=actor and ec.claim_expires_at>clock_timestamp())) then
    perform internal.staff_actor('evidence:view');private_read:=true;
  end if;
  if private_read then
    select coalesce(array_agg(p.artifact_id),'{}') into ids from private.frontend_business_seen_files p join private.evidence_artifacts a on a.id=p.artifact_id
      where p.check_id=x.id and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,ec.id,'routine_review',ec.version,ec.claim_generation,ids);
  end if;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind','seen','status',x.status,'createdAt',x.created_at,'updatedAt',x.updated_at,
    'decidedAt',x.decided_at,'expiresAt',x.expires_at,'reviewNote',case when private_read then x.review_note end,'reasonCode',x.reason_code,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',pr.display_name,'legalName',case when private_read then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'seen',jsonb_build_object('method',x.seen_method,'address',case when private_read then x.visit_address end,
      'slots',case when private_read then x.available_slots end,'assignedTo',x.assigned_to,'scheduledFor',x.scheduled_for,
      'photos',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('fileId',ph.artifact_id,'by',ph.verifier_id,'takenAt',ph.created_at,
        'lat',ph.latitude,'lng',ph.longitude) order by ph.created_at,ph.artifact_id) from private.frontend_business_seen_photos ph
        where ph.artifact_id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
      'report',case when private_read and x.visit_report is not null then x.visit_report||jsonb_build_object('by',x.report_by,'at',x.report_at) end),
    'files',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',ph.kind,
      'content_type',ph.mime,'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at)
      order by a.created_at,a.id) from private.evidence_artifacts a join private.frontend_business_seen_files ph on ph.artifact_id=a.id
      where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end) order by m.created_at,m.id)
      from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb)
      else '[]'::jsonb end)
  into answer from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return answer;
end$$;
create function api.get_frontend_seen_case(p_case uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_frontend_seen_case(p_case)$$;

create function internal.reserve_frontend_seen_reply_file(p_business uuid,p_case uuid,p_digest text,p_mime text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();x private.frontend_business_checks;art private.evidence_artifacts;prior private.frontend_business_reply_files;
begin
  if p_digest is null or p_digest !~ '^[0-9a-f]{64}$' or p_mime is null or p_mime not in('image/jpeg','image/png','image/webp','application/pdf')
    then raise exception 'valid business check attachment required' using errcode='22023';end if;
  perform internal.lock_verification_subject(actor);actor:=internal.price_draft_actor();
  select b.* into x from private.frontend_business_checks b join private.posts p on p.id=b.business_id and p.owner_id=b.owner_id
    join private.evidence_cases c on c.id=b.id and c.status='open'
    where b.id=p_case and b.business_id=p_business and b.owner_id=actor and b.kind='seen' and b.status in('pending','info_requested') for update of b;
  if not found then raise exception 'open business check not found' using errcode='PT404';end if;
  select * into prior from private.frontend_business_reply_files f where f.check_id=x.id and f.content_digest=p_digest;
  if found then
    select * into art from private.evidence_artifacts where id=prior.artifact_id;
    if prior.mime<>p_mime or art.state not in('intent','uploaded','clean') then raise exception 'attachment is no longer available' using errcode='PT409';end if;
    return jsonb_build_object('artifact_id',art.id,'owner_id',actor,'completed',art.state='clean');
  end if;
  if (select count(*) from private.frontend_business_reply_files where check_id=x.id)>=20 then raise exception 'attachment limit reached' using errcode='PT429';end if;
  insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key)
    values(x.id,actor,'business_reply_attachment','evidence/'||x.id||'/'||gen_random_uuid()) returning * into art;
  insert into private.frontend_business_reply_files(artifact_id,check_id,content_digest,mime) values(art.id,x.id,p_digest,p_mime);
  return jsonb_build_object('artifact_id',art.id,'owner_id',actor,'completed',false);
end$$;
create function api.reserve_frontend_seen_reply_file(p_business uuid,p_case uuid,p_digest text,p_mime text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reserve_frontend_seen_reply_file(p_business,p_case,p_digest,p_mime)$$;

create function internal.send_frontend_seen_message(p_case uuid,p_body text,p_business uuid default null,p_artifact uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;subject uuid;x private.frontend_business_checks;c private.evidence_cases;body_text text;
begin
  if p_business is null then actor:=internal.staff_actor('evidence:view');else actor:=internal.price_draft_actor();end if;
  body_text:=internal.privacy_text(coalesce(nullif(btrim(p_body),''),case when p_artifact is not null then 'Attached a file.' end),1,2000);
  select owner_id into subject from private.frontend_business_checks where id=p_case and kind='seen';
  if subject is null then raise exception 'business check unavailable' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);
  select * into c from private.evidence_cases where id=p_case and status='open' for update;
  select * into x from private.frontend_business_checks where id=p_case and status in('pending','info_requested') for update;
  if c.id is null or x.id is null or not exists(select 1 from private.posts p where p.id=x.business_id and p.owner_id=subject)
    then raise exception 'business check is no longer open' using errcode='PT409';end if;
  if p_business is not null then
    actor:=internal.price_draft_actor();
    if actor<>subject or x.business_id<>p_business then raise exception 'business check unavailable' using errcode='PT404';end if;
    if p_artifact is not null then
      if not exists(select 1 from private.frontend_business_reply_files f join private.evidence_artifacts a on a.id=f.artifact_id
        where f.check_id=x.id and f.artifact_id=p_artifact and a.owner_id=actor and a.state='clean' and a.content_sha256=f.content_digest)
        then raise exception 'confirmed owner attachment required' using errcode='PT409';end if;
      if exists(select 1 from private.frontend_business_check_messages m where m.attachment_file_id=p_artifact) then
        if exists(select 1 from private.frontend_business_check_messages m where m.attachment_file_id=p_artifact and m.author_id=actor and m.body=body_text)
          then return jsonb_build_object('ok',true);end if;
        raise exception 'attachment is already part of another message' using errcode='PT409';
      end if;
    end if;
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body,attachment_file_id) values(x.id,actor,'owner',body_text,p_artifact);
    update private.frontend_business_checks set status='pending',updated_at=clock_timestamp() where id=x.id;
    perform internal.price_draft_actor();
  else
    if p_artifact is not null then raise exception 'staff message attachments are not accepted here' using errcode='22023';end if;
    actor:=internal.staff_actor('evidence:view');
    if actor=subject or not coalesce(x.assigned_to=actor or (c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false)
      then raise exception 'assigned or claimed independent staff required' using errcode='42501';end if;
    insert into private.frontend_business_check_messages(check_id,author_id,author_role,body) values(x.id,actor,'staff',body_text);
    perform internal.staff_actor('evidence:view');
  end if;
  return jsonb_build_object('ok',true);
end$$;
create function api.send_frontend_seen_message(p_case uuid,p_body text,p_business uuid default null,p_artifact uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.send_frontend_seen_message(p_case,p_body,p_business,p_artifact)$$;

create function internal.authorize_frontend_seen_file(p_artifact uuid,p_record boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.staff_actor('evidence:view');subject uuid;check_id uuid;x private.frontend_business_checks;c private.evidence_cases;
begin
  select b.id,b.owner_id into check_id,subject from private.frontend_business_seen_files ph join private.frontend_business_checks b on b.id=ph.check_id
    where ph.artifact_id=p_artifact;
  if subject is null then raise exception 'photo not available' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('evidence:view');
  select * into x from private.frontend_business_checks where id=check_id;
  select * into c from private.evidence_cases where id=check_id;
  if actor=subject or not coalesce(actor=x.assigned_to or actor=x.reviewed_by
    or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false)
    then raise exception 'an authorized verifier must view this photo' using errcode='42501';end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_artifact and a.case_id=c.id and a.state='clean'
      and (a.retain_until is null or a.retain_until>clock_timestamp()))
    then raise exception 'photo not available' using errcode='PT404';end if;
  if p_record then
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,array[p_artifact]);
  end if;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('case_id',c.id,'version',c.version,'artifact_id',p_artifact);
end$$;
create function api.authorize_frontend_seen_file(p_artifact uuid,p_record boolean default false)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.authorize_frontend_seen_file(p_artifact,p_record)$$;

create function internal.frontend_seen_file_object(p_case uuid,p_artifact uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select jsonb_build_object('object_key',a.object_key,'sha256',a.sha256,'content_sha256',a.content_sha256,
    'size_bytes',a.size_bytes,'mime',p.mime)
  from private.evidence_artifacts a join private.frontend_business_seen_files p on p.artifact_id=a.id and p.check_id=a.case_id
  where a.id=p_artifact and a.case_id=p_case and a.purpose in('business_visit_photo','business_reply_attachment') and a.state='clean'
    and a.content_sha256=p.content_digest and (a.retain_until is null or a.retain_until>statement_timestamp());
$$;
create function api.frontend_seen_file_object(p_case uuid,p_artifact uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$select internal.frontend_seen_file_object(p_case,p_artifact)$$;
revoke all on function internal.frontend_seen_file_object(uuid,uuid),api.frontend_seen_file_object(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function internal.frontend_seen_file_object(uuid,uuid),api.frontend_seen_file_object(uuid,uuid) to service_role;

alter table private.notifications drop constraint notifications_kind_check;
alter table private.notifications add constraint notifications_kind_check check(kind in('enquiry_received',
  'organisation_application_received','organisation_application_decided','organisation_affiliation_ended',
  'organisation_sponsorship_activated','organisation_sponsorship_ended','partner_commission_approved','partner_commission_reversed',
  'account_warning','content_hidden','account_suspended','account_banned','appeal_decided','business_check_update'));
alter table private.outbox_events drop constraint outbox_events_kind_check;
alter table private.outbox_events add constraint outbox_events_kind_check check(kind in('payment_completed','payment_reversed',
  'payment_reconciliation_required','trial_started','post_expired','post_expiry_reminder','draft_deletion_warning','post_deleted',
  'verification_phone_confirmed','identity_accepted','enquiry_received','account_warning','content_hidden','account_suspended','account_banned',
  'appeal_decided','business_check_update'));
create function internal.notify_frontend_business_check()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare x private.frontend_business_checks;event_id uuid:=gen_random_uuid();
begin
  if tg_table_name='frontend_business_check_messages' then
    if new.author_role<>'staff' then return new;end if;
    select * into x from private.frontend_business_checks where id=new.check_id and status in('pending','info_requested');
    if not found then return new;end if;
  else
    x:=new;
    if not ((new.status is distinct from old.status and (new.status in('approved','rejected') or new.revoked_at is not null))
      or new.scheduled_for is distinct from old.scheduled_for) then return new;end if;
  end if;
  insert into private.notifications(account_id,kind,subject_id,post_id) values(x.owner_id,'business_check_update',event_id,x.business_id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('business_check_update',event_id,x.owner_id,'business_check_update:'||event_id);
  return new;
end$$;
revoke all on function internal.notify_frontend_business_check() from public,anon,authenticated,service_role;
create trigger notify_frontend_business_outcome after update of status,scheduled_for on private.frontend_business_checks
  for each row execute function internal.notify_frontend_business_check();
create trigger notify_frontend_business_message after insert on private.frontend_business_check_messages
  for each row execute function internal.notify_frontend_business_check();
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_supported_notification_outbox(text[],integer)'::regprocedure;
  if md5(body)<>'28166cba57017eac243a6941090fe9a0' then raise exception 'supported business notices drift';end if;
  changed:=replace(replace(body,'between 1 and 16','between 1 and 17'),'''appeal_decided''','''appeal_decided'',''business_check_update''');
  if changed=body or position('business_check_update' in changed)=0 then raise exception 'business notice claim anchor missing';end if;
  execute format('create or replace function internal.claim_supported_notification_outbox(p_supported_kinds text[],p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_frontend_notifications(integer,boolean,timestamptz)'::regprocedure;
  if md5(body)<>'d03622808bbf46d06d683b5ed094a894' then raise exception 'older frontend business notices drift';end if;
  changed:=replace(body,'''appeal_decided''','''appeal_decided'',''business_check_update''');
  if changed=body then raise exception 'old frontend business notice anchor missing';end if;
  execute format('create or replace function internal.list_my_frontend_notifications(p_limit integer,p_unread boolean,p_before timestamptz) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.list_my_notifications(timestamptz,uuid,integer)'::regprocedure;
  if md5(body)<>'3ba29a892817f7c26807a6283a599c0c' then raise exception 'older native business notices drift';end if;
  changed:=replace(body,'''appeal_decided''','''appeal_decided'',''business_check_update''');
  if changed=body then raise exception 'old native business notice anchor missing';end if;
  execute format('create or replace function internal.list_my_notifications(p_before_created timestamptz,p_before_id uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',changed);
end$$;

-- The same claim bar now includes Seen cases ready for booking or review.
do $$declare body text;changed text;begin
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_frontend_staff_items(text,integer)'::regprocedure;
  if md5(body)<>'59c1fd98fb7af8dce7c502b589be0cf4' then raise exception 'business claim batch drift';end if;
  changed:=replace(body,'(c.kind=''business'' and exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose=''registration'' and a.state=''clean''))',
    '(c.kind=''business'' and (exists(select 1 from private.evidence_artifacts a where a.case_id=c.id and a.purpose=''registration'' and a.state=''clean'')
      or exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind=''seen'' and x.status=''pending''
        and (x.assigned_to is null or x.visit_report is not null))))');
  if changed=body then raise exception 'seen claim batch anchor missing';end if;
  execute format('create or replace function internal.claim_frontend_staff_items(p_queue text,p_limit integer) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
  select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid='internal.claim_evidence_case(uuid)'::regprocedure;
  if md5(body)<>'dd8bd58276d7f1c110909b14a79b7178' then raise exception 'evidence claim authority drift';end if;
  changed:=replace(body,'  if c.subject_id = actor then',
    '  if c.kind=''business'' and exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind=''seen'' and x.status<>''pending'') then
    raise exception ''seen check is not ready for a claim'' using errcode=''PT409'';end if;
  if c.kind=''business'' and exists(select 1 from private.frontend_business_checks x where x.id=c.id and x.kind=''seen''
    and x.assigned_to is not null and x.assigned_to<>actor and x.visit_report is null) then
    perform internal.staff_actor(''decision:approve'');end if;
  if c.subject_id = actor then');
  if changed=body then raise exception 'seen claim subject anchor missing';end if;
  execute format('create or replace function internal.claim_evidence_case(p_case_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as %L',changed);
end$$;

do $$declare signature text;ns text;begin
  foreach signature in array array['request_frontend_business_seen(uuid,text,text[],boolean,text)','withdraw_frontend_business_check(uuid,uuid)','get_my_frontend_business_checks(uuid)','reserve_frontend_seen_photo(uuid,text,numeric,numeric,text)','get_frontend_seen_photo_receipt(uuid,uuid)','schedule_frontend_seen_check(uuid,timestamptz,timestamptz,text,uuid)','report_frontend_seen_check(uuid,timestamptz,jsonb)','decide_frontend_seen_check(uuid,timestamptz,text,text,uuid,text,text)','revoke_frontend_seen_check(uuid,timestamptz,text,text)','get_frontend_seen_queue(text)','get_frontend_seen_case(uuid)','send_frontend_seen_message(uuid,text,uuid,uuid)','reserve_frontend_seen_reply_file(uuid,uuid,text,text)','authorize_frontend_seen_file(uuid,boolean)'] loop
    foreach ns in array array['api','internal'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated,service_role',ns,signature);
      execute format('grant execute on function %I.%s to authenticated',ns,signature);
    end loop;
  end loop;
end$$;
notify pgrst,'reload schema';
commit;
