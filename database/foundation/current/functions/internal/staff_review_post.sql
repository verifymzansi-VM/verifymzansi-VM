-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_review_post(p_post_id uuid, p_claim_generation text, p_claim_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.staff_actor('post:moderate'); c private.queue_claims; dto jsonb;
begin
  select q.* into c from private.queue_claims q join private.posts p on p.id = q.post_id
    where q.post_id = p_post_id and p.status = 'pending_moderation';
  if internal.queue_conflict(actor, p_post_id, null) then
    raise exception 'self-review is not allowed' using errcode = '42501';
  end if;
  perform internal.assert_queue_claim(c, actor, p_claim_generation, p_claim_nonce);
  dto := internal.post_review_view(p_post_id);
  if dto->>'edit_of' is not null then
    dto := dto || jsonb_build_object('live_version', internal.post_review_view((dto->>'edit_of')::uuid));
  end if;
  return dto;
end;
$function$;
alter function internal.staff_review_post(uuid,text,uuid) owner to postgres;
revoke all on function internal.staff_review_post(uuid,text,uuid) from public;
grant execute on function internal.staff_review_post(uuid,text,uuid) to authenticated;
