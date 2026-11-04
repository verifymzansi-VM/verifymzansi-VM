-- Server-attested form commands compose canonical posting operations in one
-- transaction. Supplemental fields are public owner assertions, never grants.
begin;
set local lock_timeout='5s';
create table private.frontend_post_commands(
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  digest text not null check(digest ~ '^[a-f0-9]{64}$'),
  payload jsonb check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=131072),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  primary key(owner_id,request_id),check(payload is not null or result is not null)
);
create table private.post_presentations(
  post_id uuid primary key references private.posts(id) on delete cascade,
  data jsonb not null check(jsonb_typeof(data)='object' and octet_length(data::text)<=65536),
  contacts jsonb not null default '{}'::jsonb check(jsonb_typeof(contacts)='object' and octet_length(contacts::text)<=1024)
);
-- Single-column object FK is intentionally discoverable by the existing native
-- media_object_in_use retention guard. Linking locks the ready owned objects.
create table private.post_presentation_media(
  post_id uuid not null references private.posts(id) on delete cascade,
  object_id uuid not null references private.media_objects(id) on delete restrict,
  purpose text not null check(purpose in('logo','poster','venue')),
  position smallint not null check(position between 0 and 9 and (purpose='venue' or position=0)),
  primary key(post_id,purpose,position),unique(post_id,purpose,object_id)
);
create index post_presentation_media_object_idx on private.post_presentation_media(object_id);
create table private.post_slugs(
  slug text primary key check(slug ~ '^[a-z0-9-]{3,60}$'),
  post_id uuid not null references private.posts(id) on delete cascade
);
create index post_slugs_post_idx on private.post_slugs(post_id);
alter table private.frontend_post_commands enable row level security;
alter table private.post_presentations enable row level security;
alter table private.post_presentation_media enable row level security;
alter table private.post_slugs enable row level security;
revoke all on private.frontend_post_commands,private.post_presentations,private.post_presentation_media,private.post_slugs from public,anon,authenticated,service_role;

-- Private helper used only after native public visibility or self ownership has
-- already been established. Contact numbers never enter the public projection.
create function internal.frontend_post_presentation(p_post uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('data',coalesce((select data from private.post_presentations where post_id=p_post),'{}'::jsonb),
   'media',coalesce((select jsonb_agg(jsonb_build_object('purpose',r.purpose,'position',r.position,'object_key',m.object_key,
     'width',m.width,'height',m.height) order by r.purpose,r.position)
     from private.post_presentation_media r join private.media_objects m on m.id=r.object_id
     join private.posts p on p.id=r.post_id and p.owner_id=m.owner_id
     where r.post_id=p_post and m.state='ready' and m.kind='image'),'[]'::jsonb));
$$;
revoke all on function internal.frontend_post_presentation(uuid) from public,anon,authenticated,service_role;
create function internal.frontend_owner_post(p_post uuid,p_actor uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category',p.category_key,'activity',p.activity_key,
   'status',p.status,'status_reason',p.status_reason,'revision',p.revision,'edit_of',p.edit_of,
   'created_at',p.created_at,'updated_at',p.content_updated_at,'published_at',p.published_at,'expires_at',p.visible_until,
   'content',jsonb_build_object('title',p.title,'description',p.description,'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
   'listing',case when p.kind='listing' then (select to_jsonb(d)-array['post_id','post_kind'] from private.listing_details d where d.post_id=p.id) end,
   'business_type',(select d.business_type from private.business_details d where d.post_id=p.id),
   'event_window',(select jsonb_build_object('starts_at',e.starts_at,'ends_at',e.ends_at,'timezone',e.timezone) from private.event_details e where e.post_id=p.id),
   'contact_channels',(select channels from private.post_contacts c where c.post_id=p.id),
   'media',coalesce((select jsonb_agg(jsonb_build_object('object_id',m.id,'object_key',m.object_key,'kind',m.kind,'state',m.state,
     'purpose',r.purpose,'position',r.position,'width',m.width,'height',m.height,'focal_x',r.focal_x,'focal_y',r.focal_y) order by r.purpose,r.position)
     from private.post_media r join private.media_objects m on m.id=r.object_id and m.owner_id=p.owner_id where r.post_id=p.id),'[]'::jsonb),
   'frontend',internal.frontend_post_presentation(p.id),
   'contacts',coalesce((select contacts from private.post_presentations where post_id=p.id),'{}'::jsonb),
   'pending_edit',(select jsonb_build_object('id',e.id,'status',e.status,'revision',e.revision) from private.posts e where e.edit_of=p.id and e.owner_id=p_actor))
 from private.posts p where p.id=p_post and p.owner_id=p_actor;
$$;
revoke all on function internal.frontend_owner_post(uuid,uuid) from public,anon,authenticated,service_role;
create function internal.get_my_frontend_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();result jsonb;begin
  result:=internal.frontend_owner_post(p_id,actor);perform internal.price_draft_actor();return result;
end$$;
revoke all on function internal.get_my_frontend_post(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_my_frontend_post(uuid) to authenticated;
create function api.get_my_frontend_post(p_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.get_my_frontend_post(p_id)$$;
revoke all on function api.get_my_frontend_post(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_my_frontend_post(uuid) to authenticated;
create function internal.list_my_frontend_posts(p_kind text,p_area text default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();rows jsonb;total bigint;begin
  if p_kind is null or p_kind not in('listing','business','event') or p_limit is null or p_limit not between 1 and 100
    or p_offset is null or p_offset not between 0 and 100000 or (p_area is not null and p_area not in('market','business','tourism_events')) then
    raise exception 'bounded owner post query required' using errcode='22023'; end if;
  select count(*) into total from private.posts p where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area);
  select coalesce(jsonb_agg(internal.frontend_owner_post(p.id,actor) order by p.created_at desc,p.id),'[]'::jsonb) into rows
    from (select id,created_at from private.posts where owner_id=actor and kind=p_kind and edit_of is null and (p_area is null or area=p_area)
      order by created_at desc,id limit p_limit offset p_offset) p;
  perform internal.price_draft_actor();return jsonb_build_object('items',rows,'total',total,'limit',p_limit,'offset',p_offset);
end$$;
revoke all on function internal.list_my_frontend_posts(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_frontend_posts(text,text,integer,integer) to authenticated;
create function api.list_my_frontend_posts(p_kind text,p_area text default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.list_my_frontend_posts(p_kind,p_area,p_limit,p_offset)$$;
revoke all on function api.list_my_frontend_posts(text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function api.list_my_frontend_posts(text,text,integer,integer) to authenticated;

create function internal.stage_frontend_post_command(p_owner uuid,p_request uuid,p_digest text,p_payload jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare prior private.frontend_post_commands;
begin
  if p_request is null or p_owner is null or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>131072
    or p_payload->>'request_id' is distinct from p_request::text then
    raise exception 'validated form command required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(p_owner);
  if not exists(select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active member required' using errcode='42501'; end if;
  select * into prior from private.frontend_post_commands where owner_id=p_owner and request_id=p_request for update;
  if found then
    if prior.digest<>p_digest then raise exception 'form request changed; reload your posts before retrying' using errcode='PT409',detail='post_request_changed'; end if;
    if prior.result is null and prior.expires_at<=clock_timestamp() then raise exception 'form request expired' using errcode='PT409'; end if;
    return true;
  end if;
  insert into private.frontend_post_commands(owner_id,request_id,digest,payload) values(p_owner,p_request,p_digest,p_payload);
  return true;
end$$;
revoke all on function internal.stage_frontend_post_command(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.stage_frontend_post_command(uuid,uuid,text,jsonb) to service_role;
create function api.stage_frontend_post_command(p_owner uuid,p_request uuid,p_digest text,p_payload jsonb)
returns boolean language sql security invoker set search_path=pg_catalog as $$select internal.stage_frontend_post_command(p_owner,p_request,p_digest,p_payload)$$;
revoke all on function api.stage_frontend_post_command(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.stage_frontend_post_command(uuid,uuid,text,jsonb) to service_role;

create function internal.save_frontend_post_presentation(p_post uuid,p_data jsonb,p_contacts jsonb,p_media jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare post private.posts; selected_slug text; original uuid;
begin
  select * into post from private.posts where id=p_post;
  if post.id is null or jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_contacts) is distinct from 'object'
    or jsonb_typeof(p_media) is distinct from 'array' or jsonb_array_length(p_media)>12 then
    raise exception 'post presentation unavailable' using errcode='22023'; end if;
  -- Server-only staging excludes private account fields and contact numbers.
  if p_data ?| array['owner_id','user_id','account_id','role','capabilities','verified','identity_verified','phone','whatsapp','status','entitlement_id'] then
    raise exception 'non-presentation field refused' using errcode='22023'; end if;
  perform m.id from private.media_objects m where m.id in(select (i->>'object_id')::uuid from jsonb_array_elements(p_media) i) order by m.id for update;
  if exists(select 1 from jsonb_array_elements(p_media) i left join private.media_objects m on m.id=(i->>'object_id')::uuid
    where m.id is null or m.owner_id<>post.owner_id or m.state<>'ready' or m.kind<>'image') then
    raise exception 'presentation media must be your finished image uploads' using errcode='22023'; end if;
  selected_slug:=p_data->>'slug'; original:=coalesce(post.edit_of,post.id);
  if selected_slug is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(selected_slug,2811));
    insert into private.post_slugs(slug,post_id) values(selected_slug,original) on conflict(slug) do nothing;
    if not exists(select 1 from private.post_slugs s where s.slug=selected_slug and s.post_id=original) then
      raise exception 'business address name already in use' using errcode='PT409',detail='slug_conflict'; end if;
  end if;
  insert into private.post_presentations(post_id,data,contacts) values(post.id,p_data,p_contacts)
    on conflict(post_id) do update set data=excluded.data,contacts=excluded.contacts;
  delete from private.post_presentation_media where post_id=post.id;
  insert into private.post_presentation_media(post_id,object_id,purpose,position)
    select post.id,(i->>'object_id')::uuid,i->>'purpose',(i->>'position')::smallint from jsonb_array_elements(p_media) i;
end$$;
revoke all on function internal.save_frontend_post_presentation(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

create function internal.consume_frontend_post_command(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); command private.frontend_post_commands; input jsonb;
  post private.posts; created jsonb; changed jsonb; terms jsonb; answer jsonb; trial jsonb; rev integer; target uuid; wants_edit boolean:=false;
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
  perform internal.accept_posting_terms(input->'terms'->>'version',input->'terms'->>'document_hash');
  target:=(input->>'target_id')::uuid;
  if target is not null then
    select * into post from private.posts where id=target and owner_id=actor for update;
    if not found or post.kind is distinct from input->'context'->>'kind' or post.area is distinct from input->'context'->>'area'
      or post.edit_of is not null then raise exception 'owned post unavailable' using errcode='42501'; end if;
    if post.revision is distinct from (input->>'expected_revision')::integer then raise exception 'post changed; reload before saving' using errcode='PT409'; end if;
    if post.status='live' then
      created:=internal.create_post_edit(post.id,post.revision);target:=(created->>'id')::uuid;wants_edit:=true;
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
    changed:=internal.save_business_event_context(post.id,rev,jsonb_build_object('event_window',input->'detail'-'contact_channels'));
    rev:=(changed->>'revision')::integer;
  end if;
  if post.kind in('listing','event') then
    changed:=internal.set_post_contacts(post.id,rev,input->'detail'->'contact_channels');rev:=(changed->>'revision')::integer;
  end if;
  -- All references are journalled before submission. Extra venue/logo/poster
  -- images have separate bounded slots and do not consume gallery places.
  perform internal.save_frontend_post_presentation(post.id,input->'presentation',coalesce(input->'contacts','{}'::jsonb),input->'presentation_media');
  changed:=internal.set_post_media(post.id,rev,input->'media');rev:=(changed->>'revision')::integer;
  begin
    answer:=internal.submit_post(post.id,rev);
  exception when sqlstate 'PT402' then
    if post.kind='event' or wants_edit or input->>'trial_days' is null then raise; end if;
    trial:=internal.grant_verified_intro_trial(actor,(input->>'trial_days')::integer);
    if not coalesce((trial->>'granted')::boolean,false) then raise exception 'an active posting plan is required' using errcode='PT402'; end if;
    answer:=internal.submit_post(post.id,rev);
  end;
  answer:=answer||jsonb_build_object('original_id',coalesce(post.edit_of,post.id),'edit_of',post.edit_of);
  update private.frontend_post_commands set result=answer,payload=null where owner_id=actor and request_id=p_request;
  perform internal.price_draft_actor();
  return answer;
end$$;
revoke all on function internal.consume_frontend_post_command(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.consume_frontend_post_command(uuid) to authenticated;
create function api.consume_frontend_post_command(p_request uuid) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.consume_frontend_post_command(p_request)$$;
revoke all on function api.consume_frontend_post_command(uuid) from public,anon,authenticated,service_role;
grant execute on function api.consume_frontend_post_command(uuid) to authenticated;

create function internal.copy_frontend_post_presentation(p_from uuid,p_to uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$begin
  if not exists(select 1 from private.posts a join private.posts b on b.owner_id=a.owner_id where a.id=p_from and b.id=p_to and (a.edit_of=b.id or b.edit_of=a.id)) then
    raise exception 'owned edit relationship required' using errcode='23514'; end if;
  delete from private.post_presentations where post_id=p_to;
  insert into private.post_presentations select p_to,data,contacts from private.post_presentations where post_id=p_from;
  delete from private.post_presentation_media where post_id=p_to;
  insert into private.post_presentation_media select p_to,object_id,purpose,position from private.post_presentation_media where post_id=p_from;
end$$;
revoke all on function internal.copy_frontend_post_presentation(uuid,uuid) from public,anon,authenticated,service_role;
create function internal.frontend_edit_copy_created() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin
  if new.edit_of is not null then perform internal.copy_frontend_post_presentation(new.edit_of,new.id); end if; return new;
end$$;
revoke all on function internal.frontend_edit_copy_created() from public,anon,authenticated,service_role;
create trigger frontend_edit_copy_created after insert on private.posts for each row execute function internal.frontend_edit_copy_created();
create function internal.purge_frontend_post_commands(p_limit integer)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare candidate record; held private.frontend_post_commands;
begin
  for candidate in select owner_id,request_id from private.frontend_post_commands
    where (result is null and payload is distinct from '{"expired":true}'::jsonb and expires_at<=statement_timestamp())
      or created_at<statement_timestamp()-interval '90 days' order by created_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    select * into held from private.frontend_post_commands where owner_id=candidate.owner_id and request_id=candidate.request_id for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null) then continue; end if;
    if held.created_at<statement_timestamp()-interval '90 days' then
      delete from private.frontend_post_commands where owner_id=candidate.owner_id and request_id=candidate.request_id;
    elsif held.result is null and held.expires_at<=statement_timestamp() then
      update private.frontend_post_commands set payload='{"expired":true}'::jsonb where owner_id=candidate.owner_id and request_id=candidate.request_id;
    end if;
  end loop;
end$$;
revoke all on function internal.purge_frontend_post_commands(integer) from public,anon,authenticated,service_role;
create function internal.frontend_edit_presentation_same(p_original uuid,p_edit uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select (select jsonb_build_object('data',data,'contacts',contacts) from private.post_presentations where post_id=p_original)
    is not distinct from (select jsonb_build_object('data',data,'contacts',contacts) from private.post_presentations where post_id=p_edit)
    and coalesce((select jsonb_agg(to_jsonb(m)-'post_id' order by purpose,position) from private.post_presentation_media m where post_id=p_original),'[]'::jsonb)
      =coalesce((select jsonb_agg(to_jsonb(m)-'post_id' order by purpose,position) from private.post_presentation_media m where post_id=p_edit),'[]'::jsonb);
$$;
revoke all on function internal.frontend_edit_presentation_same(uuid,uuid) from public,anon,authenticated,service_role;

-- Reviewed exact native bodies, preserving existing owners/signatures/grants.
do $$declare body text; before text; begin
  select prosrc into body from pg_proc where oid='internal.apply_post_edit(uuid,uuid)'::regprocedure;
  if md5(replace(body,E'\r\n',E'\n'))<>'7c9f6e649b8dc8596e6cc2322d297ee2' then raise exception 'apply_post_edit drift'; end if;
  before:=replace(pg_get_functiondef('internal.apply_post_edit(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  body:=replace(before,'delete from private.posts where id = edit.id;', 'perform internal.copy_frontend_post_presentation(edit.id,original.id); delete from private.posts where id = edit.id;');
  if body=before then raise exception 'edit merge anchor missing'; end if;execute body;
  select prosrc into body from pg_proc where oid='internal.edit_is_price_only(uuid,uuid)'::regprocedure;
  if md5(replace(body,E'\r\n',E'\n'))<>'fb78ac886ccffb6456114635c6e4a528' then raise exception 'edit_is_price_only drift'; end if;
  before:=replace(pg_get_functiondef('internal.edit_is_price_only(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
  body:=replace(before,'where o.id = p_original_id), false);','where o.id = p_original_id and internal.frontend_edit_presentation_same(p_original_id,p_edit_id)), false);');
  if body=before then raise exception 'price-only anchor missing'; end if;execute body;
  select prosrc into body from pg_proc where oid='internal.search_post_cards(jsonb)'::regprocedure;
  if md5(replace(body,E'\r\n',E'\n'))<>'2e87d0c21cd34def9260b58ddcdcc30d' then raise exception 'search_post_cards drift'; end if;
  before:=replace(pg_get_functiondef('internal.search_post_cards(jsonb)'::regprocedure),E'\r\n',E'\n');
  body:=replace(before,'presentation boolean:=false;', 'presentation boolean:=false; frontend boolean:=false;');
  body:=replace(body,'result := internal.search_posts(p_request-''presentation'');',
    'if p_request ? ''frontend_presentation'' then
      if jsonb_typeof(p_request->''frontend_presentation'') is distinct from ''boolean'' then raise exception ''invalid frontend presentation option'' using errcode=''22023''; end if;
      frontend:=(p_request->>''frontend_presentation'')::boolean;
    end if;
    if frontend and not presentation then raise exception ''presentation option required'' using errcode=''22023''; end if;
    result := internal.search_posts(p_request-array[''presentation'',''frontend_presentation'']);');
  body:=replace(body,'from private.event_details e where e.post_id=(item.value->>''id'')::uuid)
  )) else',
    'from private.event_details e where e.post_id=(item.value->>''id'')::uuid)
  ) || case when frontend then jsonb_build_object(''frontend'',internal.frontend_post_presentation((item.value->>''id'')::uuid)) else ''{}''::jsonb end) else');
  if body=before then raise exception 'public presentation anchor missing'; end if;execute body;
  select prosrc into body from pg_proc where oid='internal.run_retention(integer)'::regprocedure;
  if md5(replace(body,E'\r\n',E'\n'))<>'cb7ea53b1b3bbdfc1be9dd50244fb187' then raise exception 'run_retention drift'; end if;
  before:=replace(pg_get_functiondef('internal.run_retention(integer)'::regprocedure),E'\r\n',E'\n');
  body:=replace(before,'result:=jsonb_build_object(', 'perform internal.purge_frontend_post_commands(p_limit); result:=jsonb_build_object(');
  if body=before then raise exception 'retention anchor missing'; end if;execute body;
end$$;
notify pgrst,'reload schema';
commit;
