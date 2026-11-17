-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); post private.posts; c jsonb := p_content; rev integer;
  city text; locality text; title_value text; description_value text;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text) > 12000
    or not (array(select jsonb_object_keys(c)) <@ array['title', 'description', 'province_id', 'city_id', 'locality_label'])
    or exists (select 1 from jsonb_each(c) e where jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if (c ? 'city_id' and c->>'city_id' is not null) and (c ? 'locality_label' and c->>'locality_label' is not null) then
    raise exception 'choose a listed city or type a locality, not both' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(c) e where e.key in ('title','description') and
    e.value #>> '{}' ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]') then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  if c->>'title' is not null then
    title_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='event' then 120 else 100 end),c->'title') #>> '{}','');
  end if;
  if c->>'description' is not null then
    description_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='business' then 3000 else 5000 end),c->'description') #>> '{}','');
  end if;
  if c->>'locality_label' is not null then
    locality := nullif(internal.validate_attribute_value('{"type":"string","maxLength":80}'::jsonb,
      c->'locality_label') #>> '{}','');
  end if;
  city := case when c ? 'city_id' then c->>'city_id'
    when locality is not null then null else post.city_id end;
  locality := case when c ? 'locality_label' then locality
    when c->>'city_id' is not null then null else post.locality_label end;
  if (city is not null and locality is not null) or (locality is not null and
    (length(locality)>80 or locality ~ U&'[\0001-\001F\007F-\009F\200B-\200F\202A-\202E\2060-\206F]')) then
    raise exception 'invalid public locality' using errcode='22023';
  end if;
  update private.posts set
    title = case when c ? 'title' then title_value else title end,
    description = case when c ? 'description' then description_value else description end,
    province_id = case when c ? 'province_id' then c->>'province_id' else province_id end,
    city_id = city,
    locality_label = locality,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$function$;
alter function internal.save_post_content(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.save_post_content(uuid,integer,jsonb) from public;
grant execute on function internal.save_post_content(uuid,integer,jsonb) to authenticated;
