-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_core_listing_terms(p_id uuid, p_expected_revision integer, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.save_core_listing_terms(uuid,integer,jsonb) owner to postgres;
revoke all on function internal.save_core_listing_terms(uuid,integer,jsonb) from public;
grant execute on function internal.save_core_listing_terms(uuid,integer,jsonb) to authenticated;
