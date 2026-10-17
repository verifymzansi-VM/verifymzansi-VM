-- Local continuation only. DEC-16 permits negotiable Price on request.
-- Price metadata is advertising content, never billing/publication authority.
create function internal.validated_listing_terms(p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare price jsonb; mode text; cents numeric; negotiable boolean;
begin
  if p_category_key is null or p_category_key not in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') then
    raise exception 'invalid price category' using errcode='22023';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or octet_length(p_terms::text)>512
    or not(array(select jsonb_object_keys(p_terms)) <@ array['price','negotiable']) then
    raise exception 'invalid price terms' using errcode='22023';
  end if;
  price:=p_terms->'price';
  if jsonb_typeof(price) is distinct from 'object' or jsonb_typeof(price->'mode') is distinct from 'string'
    or (p_terms ? 'negotiable' and jsonb_typeof(p_terms->'negotiable') is distinct from 'boolean') then
    raise exception 'explicit price required' using errcode='22023';
  end if;
  mode:=price->>'mode'; negotiable:=coalesce((p_terms->>'negotiable')::boolean,false);
  if mode='amount' then
    if not(array(select jsonb_object_keys(price)) <@ array['mode','amount_cents']) or jsonb_typeof(price->'amount_cents') is distinct from 'number' then
      raise exception 'invalid amount fields' using errcode='22023';
    end if;
    cents:=(price->>'amount_cents')::numeric;
    if cents not between 1 and 9999999900 or mod(cents,1)<>0 then
      raise exception 'invalid amount' using errcode='22023';
    end if;
  elsif mode in ('free','on_request') then
    if not(array(select jsonb_object_keys(price)) <@ array['mode']) then
      raise exception 'hidden amount prohibited' using errcode='22023';
    end if;
    cents:=case when mode='free' then 0 else null end;
  else raise exception 'invalid price mode' using errcode='22023';
  end if;
  if (p_category_key='jobs_services' and (mode='free' or negotiable)) or (mode='free' and negotiable) then
    raise exception 'invalid category price terms' using errcode='22023';
  end if;
  return jsonb_build_object('price_mode',mode,'price_cents',cents::bigint,'price_negotiable',negotiable);
end;
$$;
revoke all on function internal.validated_listing_terms(text,jsonb) from public,anon,authenticated,service_role;

alter table private.listing_price_drafts drop constraint price_draft_negotiability;
alter table private.listing_price_drafts add constraint price_draft_negotiability check
  (not price_negotiable or (price_mode in ('amount','on_request') and category_key<>'jobs_services'));
create or replace function internal.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); terms jsonb:=internal.validated_listing_terms(p_category_key,p_terms); result jsonb;
begin
  if p_expected_revision is null or p_expected_revision not between 0 and 2147483646 then
    raise exception 'invalid draft revision' using errcode='22023';
  end if;
  if p_expected_revision=0 then
    insert into private.listing_price_drafts as d(owner_id,category_key,price_mode,price_cents,price_negotiable,revision,expires_at)
      values(actor,p_category_key,terms->>'price_mode',(terms->>'price_cents')::bigint,(terms->>'price_negotiable')::boolean,1,statement_timestamp()+interval '14 days')
      on conflict(owner_id) do update set category_key=excluded.category_key,price_mode=excluded.price_mode,
        price_cents=excluded.price_cents,price_negotiable=excluded.price_negotiable,revision=d.revision+1,expires_at=excluded.expires_at
        where d.expires_at<=statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  else
    update private.listing_price_drafts d set category_key=p_category_key,price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
      price_negotiable=(terms->>'price_negotiable')::boolean,revision=d.revision+1,expires_at=statement_timestamp()+interval '14 days'
      where d.owner_id=actor and d.revision=p_expected_revision and d.expires_at>statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  end if;
  if result is null then raise exception 'draft changed or expired' using errcode='PT409'; end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return result;
end;
$$;
revoke all on function internal.save_listing_price_draft(integer,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_listing_price_draft(integer,text,jsonb) to authenticated;

-- Two source categories are exercised here; final taxonomy approval is separate.
insert into private.post_category_contracts values ('electronics','listing','market'),('jobs_services','listing','market');
alter table private.listing_details add column price_mode text, add column price_cents bigint,
  add column price_negotiable boolean not null default false;
alter table private.listing_details add constraint core_price_consistency check (
  (price_mode is null and price_cents is null and not price_negotiable) or
  (price_mode is not null and (
    (price_mode='amount' and price_cents is not null and price_cents between 1 and 9999999900) or
    (price_mode='free' and price_cents is not null and price_cents=0 and not price_negotiable) or
    (price_mode='on_request' and price_cents is null)))
);
create function internal.core_listing_price_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare post uuid; category text; mode text; negotiable boolean;
begin
  if tg_table_name='posts' then post:=new.id; else post:=new.post_id; end if;
  select p.category_key into category from private.posts p where p.id=post and p.kind='listing' for update;
  if not found then return null; end if;
  select d.price_mode,d.price_negotiable into mode,negotiable from private.listing_details d where d.post_id=post;
  if category='jobs_services' and (mode='free' or negotiable) then
    raise exception 'job salary cannot be free or negotiable' using errcode='23514';
  end if;
  return null;
end;
$$;
revoke all on function internal.core_listing_price_guard() from public,anon,authenticated,service_role;
create constraint trigger core_post_price_category after insert or update on private.posts deferrable initially deferred for each row execute function internal.core_listing_price_guard();
create constraint trigger core_detail_price_category after insert or update on private.listing_details deferrable initially deferred for each row execute function internal.core_listing_price_guard();

create function internal.get_core_listing_draft(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,'status',p.status,'revision',p.revision,
    'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable)
    into result from private.posts p join private.listing_details d on d.post_id=p.id
    where p.id=p_id and p.owner_id=actor and p.kind='listing' and p.status='draft'
      and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items');
  return result;
end;
$$;
revoke all on function internal.get_core_listing_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_core_listing_draft(uuid) to authenticated;
create function api.get_core_listing_draft(p_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_core_listing_draft(p_id);
$$;
revoke all on function api.get_core_listing_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_core_listing_draft(uuid) to authenticated;

create function internal.save_core_listing_terms(p_id uuid,p_expected_revision integer,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts%rowtype; terms jsonb;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_id and copy.owner_id=actor for update of original;
  if p_expected_revision is null or p_expected_revision not between 1 and 2147483646 then
    raise exception 'invalid post revision' using errcode='22023';
  end if;
  select p.* into post from private.posts p where p.id=p_id and p.owner_id=actor and p.kind='listing' and p.status='draft'
    and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') for update;
  if not found or post.revision<>p_expected_revision then
    raise exception 'draft unavailable or changed' using errcode='PT409';
  end if;
  terms:=internal.validated_listing_terms(post.category_key,p_terms);
  update private.listing_details d set price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
    price_negotiable=(terms->>'price_negotiable')::boolean where d.post_id=post.id;
  if not found then raise exception 'missing listing detail' using errcode='23514'; end if;
  update private.posts p set revision=p.revision+1,content_updated_at=statement_timestamp() where p.id=post.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return internal.get_core_listing_draft(post.id);
end;
$$;
revoke all on function internal.save_core_listing_terms(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.save_core_listing_terms(uuid,integer,jsonb) to authenticated;
create function api.save_core_listing_terms(p_id uuid,p_expected_revision integer,p_terms jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_core_listing_terms(p_id,p_expected_revision,p_terms);
$$;
revoke all on function api.save_core_listing_terms(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.save_core_listing_terms(uuid,integer,jsonb) to authenticated;
