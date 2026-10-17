-- Disposable BF-03/BF-04 fixture only, not the target post model or source DDL.
-- One price draft per Auth owner; no publication, billing, evidence or media fields.
create table private.listing_price_drafts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  category_key text not null check (category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items')),
  price_mode text not null check (price_mode in ('amount','free','on_request')),
  price_cents bigint,
  price_negotiable boolean not null default false,
  revision integer not null check (revision > 0),
  expires_at timestamptz not null,
  constraint price_draft_amount_consistency check (
    (price_mode='amount' and price_cents is not null and price_cents between 1 and 9999999900) or
    (price_mode='free' and price_cents is not null and price_cents=0) or
    (price_mode='on_request' and price_cents is null)
  ),
  constraint price_draft_job_not_free check (category_key <> 'jobs_services' or price_mode <> 'free'),
  constraint price_draft_negotiability check (not price_negotiable or (price_mode='amount' and category_key <> 'jobs_services'))
);
alter table private.listing_price_drafts enable row level security;
revoke all on private.listing_price_drafts from public, anon, authenticated, service_role;

create function internal.price_draft_actor()
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := auth.uid(); claims jsonb := auth.jwt();
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean,false) then
    raise exception 'authenticated member required' using errcode='42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text=claims->>'session_id'
    and s.user_id=actor and (s.not_after is null or s.not_after>statement_timestamp())) then
    raise exception 'live session required' using errcode='42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.price_draft_actor() from public, anon, authenticated, service_role;
grant execute on function internal.price_draft_actor() to authenticated;

create function internal.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); price jsonb; mode text; cents numeric;
  negotiable boolean; result jsonb;
begin
  if p_expected_revision is null or p_expected_revision not between 0 and 2147483646
    or p_category_key is null or p_category_key not in ('property','vehicles','auto_parts','electronics','home_lifestyle','jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items') then
    raise exception 'invalid draft context' using errcode='22023';
  end if;
  if jsonb_typeof(p_terms) is distinct from 'object' or octet_length(p_terms::text)>512
    or not (array(select jsonb_object_keys(p_terms)) <@ array['price','negotiable']) then
    raise exception 'invalid terms' using errcode='22023';
  end if;
  price:=p_terms->'price';
  if jsonb_typeof(price) is distinct from 'object' or jsonb_typeof(price->'mode') is distinct from 'string' then
    raise exception 'explicit price mode required' using errcode='22023';
  end if;
  if p_terms ? 'negotiable' and jsonb_typeof(p_terms->'negotiable') is distinct from 'boolean' then
    raise exception 'invalid negotiability' using errcode='22023';
  end if;
  negotiable:=coalesce((p_terms->>'negotiable')::boolean,false); mode:=price->>'mode';
  if mode='amount' then
    if not (array(select jsonb_object_keys(price)) <@ array['mode','amount_cents'])
      or jsonb_typeof(price->'amount_cents') is distinct from 'number' then
      raise exception 'invalid amount fields' using errcode='22023';
    end if;
    cents:=(price->>'amount_cents')::numeric;
    if cents not between 1 and 9999999900 or mod(cents,1)<>0 then
      raise exception 'invalid amount' using errcode='22023';
    end if;
  elsif mode in ('free','on_request') then
    if not (array(select jsonb_object_keys(price)) <@ array['mode']) then
      raise exception 'hidden amount prohibited' using errcode='22023';
    end if;
    cents:=case when mode='free' then 0 else null end;
  else raise exception 'invalid price mode' using errcode='22023';
  end if;
  if (p_category_key='jobs_services' and (mode='free' or negotiable))
    or (negotiable and mode<>'amount') then
    raise exception 'invalid category price terms' using errcode='22023';
  end if;
  -- Compare-and-swap also fences concurrent initial saves and expired-draft resets.
  if p_expected_revision=0 then
    insert into private.listing_price_drafts as d (owner_id,category_key,price_mode,price_cents,price_negotiable,revision,expires_at)
      values (actor,p_category_key,mode,cents::bigint,negotiable,1,statement_timestamp()+interval '14 days')
      on conflict (owner_id) do update set category_key=excluded.category_key,price_mode=excluded.price_mode,
        price_cents=excluded.price_cents,price_negotiable=excluded.price_negotiable,revision=d.revision+1,
        expires_at=excluded.expires_at where d.expires_at<=statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
        'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  else
    update private.listing_price_drafts d set category_key=p_category_key,price_mode=mode,price_cents=cents::bigint,
      price_negotiable=negotiable,revision=d.revision+1,expires_at=statement_timestamp()+interval '14 days'
      where d.owner_id=actor and d.revision=p_expected_revision and d.expires_at>statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
        'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  end if;
  if result is null then raise exception 'draft changed or expired' using errcode='PT409'; end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return result;
end;
$$;
revoke all on function internal.save_listing_price_draft(integer,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.save_listing_price_draft(integer,text,jsonb) to authenticated;

create function api.save_listing_price_draft(p_expected_revision integer,p_category_key text,p_terms jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.save_listing_price_draft(p_expected_revision,p_category_key,p_terms);
$$;
revoke all on function api.save_listing_price_draft(integer,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_listing_price_draft(integer,text,jsonb) to authenticated;

create function internal.read_listing_price_draft()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,
    'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at)
    into result from private.listing_price_drafts d where d.owner_id=actor and d.expires_at>statement_timestamp();
  return result;
end;
$$;
revoke all on function internal.read_listing_price_draft() from public, anon, authenticated, service_role;
grant execute on function internal.read_listing_price_draft() to authenticated;
create function api.read_listing_price_draft()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.read_listing_price_draft();
$$;
revoke all on function api.read_listing_price_draft() from public, anon, authenticated, service_role;
grant execute on function api.read_listing_price_draft() to authenticated;
