-- Application transports over the reviewed private-domain transactions.
-- Only fixed owner/public projections and service-only leased outbox delivery.
create function internal.list_my_posts(p_limit integer default 48,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'invalid page' using errcode='22023'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category',p.category_key,'title',p.title,
    'status',p.status,'revision',p.revision,'created_at',p.created_at,
    'published_at',p.published_at,'visible_until',p.visible_until,
    'price_mode',d.price_mode,'price_cents',d.price_cents::text,
    'cover_object_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=p.id and m.state='ready' and m.kind='image' order by (pm.purpose='cover') desc,pm.position limit 1)
    ) order by p.created_at desc,p.id desc) from (select * from private.posts
      where owner_id=actor and edit_of is null order by created_at desc,id desc limit p_limit offset p_offset) p
      left join private.post_search_documents d on d.post_id=p.id),'[]'::jsonb),
    'total',(select count(*) from private.posts where owner_id=actor and edit_of is null),
    'limit',p_limit,'offset',p_offset) into result;
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.list_my_posts(integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.list_my_posts(integer,integer) to authenticated;
create function api.list_my_posts(p_limit integer default 48,p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.list_my_posts(p_limit,p_offset);
$$;
revoke all on function api.list_my_posts(integer,integer) from public,anon,authenticated,service_role;
grant execute on function api.list_my_posts(integer,integer) to authenticated;

create function internal.search_post_cards(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb:=internal.search_posts(p_request); cards jsonb;
begin
  select coalesce(jsonb_agg(item.value||jsonb_build_object('preview',jsonb_build_object(
    'image_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='image'
      order by (pm.purpose='cover') desc,pm.position limit 1),
    'video_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='video' order by pm.position limit 1)
  )) order by item.ordinality),'[]'::jsonb) into cards
  from jsonb_array_elements(result->'items') with ordinality item(value,ordinality);
  return jsonb_set(result,'{items}',cards);
end;
$$;
revoke all on function internal.search_post_cards(jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.search_post_cards(jsonb) to anon,authenticated;
create function api.search_post_cards(p_request jsonb)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.search_post_cards(p_request);
$$;
revoke all on function api.search_post_cards(jsonb) from public,anon,authenticated,service_role;
grant execute on function api.search_post_cards(jsonb) to anon,authenticated;

-- Delivery is outside the SQL transaction; leases and a stable provider key
-- make retries recoverable without replaying domain decisions.
alter table private.outbox_events add column delivery_attempts integer not null default 0 check(delivery_attempts between 0 and 20);
alter table private.outbox_events add column delivery_claim uuid;
alter table private.outbox_events add column delivery_until timestamptz;
alter table private.outbox_events add column delivery_after timestamptz not null default statement_timestamp();
alter table private.outbox_events add column delivery_error text check(delivery_error is null or delivery_error ~ '^[a-z_]{1,80}$');
create index outbox_delivery_due_idx on private.outbox_events(delivery_after,created_at) where processed_at is null;
create function internal.claim_notification_outbox(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid limit' using errcode='22023'; end if;
  with due as (select id from private.outbox_events where processed_at is null
    and delivery_attempts<8 and delivery_after<=statement_timestamp()
    and (delivery_until is null or delivery_until<statement_timestamp())
    order by created_at,id for update skip locked limit p_limit), claimed as (
    update private.outbox_events o set delivery_attempts=o.delivery_attempts+1,
      delivery_claim=pg_catalog.gen_random_uuid(),delivery_until=statement_timestamp()+interval '90 seconds'
    from due where o.id=due.id returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'kind',o.kind,'subject_id',o.subject_id,
    'owner_id',o.owner_id,'claim_token',o.delivery_claim,'locked_until',o.delivery_until,
    'attempts',o.delivery_attempts,'recipient',case when u.email_confirmed_at is not null and not u.is_anonymous then u.email end,
    'post_title',p.title,'post_id',p.id,'created_at',o.created_at) order by o.created_at,o.id),'[]'::jsonb)
    into result from claimed o left join auth.users u on u.id=o.owner_id
    left join private.enquiries e on o.kind='enquiry_received' and e.id=o.subject_id
    left join private.posts p on p.id=case when o.kind='enquiry_received' then e.post_id else o.subject_id end;
  return result;
end;
$$;
revoke all on function internal.claim_notification_outbox(integer) from public,anon,authenticated,service_role;
grant execute on function internal.claim_notification_outbox(integer) to service_role;
create function api.claim_notification_outbox(p_limit integer default 20)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.claim_notification_outbox(p_limit);
$$;
revoke all on function api.claim_notification_outbox(integer) from public,anon,authenticated,service_role;
grant execute on function api.claim_notification_outbox(integer) to service_role;
create function internal.complete_notification_outbox(p_id uuid,p_claim uuid,p_ok boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare changed integer;
begin
  if p_ok is null or (p_error is not null and p_error !~ '^[a-z_]{1,80}$') then
    raise exception 'invalid outcome' using errcode='22023'; end if;
  update private.outbox_events set processed_at=case when p_ok then statement_timestamp() else null end,
    delivery_claim=null,delivery_until=null,delivery_error=case when p_ok then null else coalesce(p_error,'delivery_failed') end,
    delivery_after=statement_timestamp()+make_interval(secs=>least(21600,30*(2^least(delivery_attempts,9))::integer))
  where id=p_id and delivery_claim=p_claim and processed_at is null and delivery_until>statement_timestamp();
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function internal.complete_notification_outbox(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function internal.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;
create function api.complete_notification_outbox(p_id uuid,p_claim uuid,p_ok boolean,p_error text default null)
returns boolean language sql security invoker set search_path=pg_catalog as $$
  select internal.complete_notification_outbox(p_id,p_claim,p_ok,p_error);
$$;
revoke all on function api.complete_notification_outbox(uuid,uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function api.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;

-- Public choices contain no numbers; revealing a selected, verified phone is
-- service-only after the application verifies a fresh CAPTCHA and rate limit.
create function internal.get_public_contact_channels(p_post_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
  select case when p.kind='business' then '["form"]'::jsonb else coalesce(to_jsonb(c.channels),'[]'::jsonb) end
  from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
  left join private.post_contacts c on c.post_id=p.id where p.id=p_post_id;
$$;
revoke all on function internal.get_public_contact_channels(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_contact_channels(uuid) to anon,authenticated;
create function api.get_public_contact_channels(p_post_id uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select internal.get_public_contact_channels(p_post_id);
$$;
revoke all on function api.get_public_contact_channels(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_public_contact_channels(uuid) to anon,authenticated;
create function internal.reveal_post_phone(p_post_id uuid,p_channel text)
returns text language plpgsql stable security definer set search_path=pg_catalog as $$
declare number text;
begin
  if p_channel is null or p_channel not in('call','whatsapp') then raise exception 'invalid channel' using errcode='22023'; end if;
  select f.phone into number from private.public_eligible_posts eligible join private.posts p on p.id=eligible.id
    join private.post_contacts c on c.post_id=p.id and p_channel=any(c.channels)
    join private.verification_phone_proofs f on f.owner_id=p.owner_id and f.revoked_at is null
    where p.id=p_post_id;
  return number;
end;
$$;
revoke all on function internal.reveal_post_phone(uuid,text) from public,anon,authenticated,service_role;
grant execute on function internal.reveal_post_phone(uuid,text) to service_role;
create function api.reveal_post_phone(p_post_id uuid,p_channel text)
returns text language sql stable security invoker set search_path=pg_catalog as $$
  select internal.reveal_post_phone(p_post_id,p_channel);
$$;
revoke all on function api.reveal_post_phone(uuid,text) from public,anon,authenticated,service_role;
grant execute on function api.reveal_post_phone(uuid,text) to service_role;

-- Verification can finish in any order. The durable job repairs a missed
-- completion event without granting another trial for a previously used identity.
create function internal.reconcile_intro_trials(p_limit integer default 20)
returns integer language plpgsql security definer set search_path=pg_catalog as $$
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
$$;
revoke all on function internal.reconcile_intro_trials(integer) from public,anon,authenticated,service_role;
grant execute on function internal.reconcile_intro_trials(integer) to service_role;
create function api.reconcile_intro_trials(p_limit integer default 20)
returns integer language sql security invoker set search_path=pg_catalog as $$
  select internal.reconcile_intro_trials(p_limit);
$$;
revoke all on function api.reconcile_intro_trials(integer) from public,anon,authenticated,service_role;
grant execute on function api.reconcile_intro_trials(integer) to service_role;
