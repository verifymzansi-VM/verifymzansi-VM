-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_moderation_queue(p_area text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');r record;rows jsonb:='[]'::jsonb;review jsonb;live jsonb;claim jsonb;total bigint;held bigint;
begin
  if p_limit is null or p_limit not between 1 and 50 or (p_area is not null and p_area not in('market','business','tourism_events')) then
    raise exception 'bounded moderation queue required' using errcode='22023';end if;
  select count(*) into total from private.posts p where p.status='pending_moderation'
    and (p_area is null or p.area=p_area) and not internal.queue_conflict(actor,p.id,null);
  select count(*) into held from private.queue_claims q where q.post_id is not null and q.claimed_by=actor and q.claim_expires_at>clock_timestamp();
  for r in
    with ranked as(select p.id,row_number() over(partition by case when p.edit_of is not null then 'edit' else p.kind end order by p.submitted_at,p.id) as n
      from private.posts p where p.status='pending_moderation' and (p_area is null or p.area=p_area) and not internal.queue_conflict(actor,p.id,null))
    select p.*,q.claimed_by,q.claim_generation,q.claim_nonce,q.claim_expires_at from ranked x join private.posts p on p.id=x.id
      left join private.queue_claims q on q.post_id=p.id and q.claim_expires_at>clock_timestamp()
      where x.n<=p_limit or q.claimed_by=actor order by p.submitted_at,p.id
  loop
    review:=null;live:=null;claim:=null;
    if r.claimed_by is not null then
      claim:=jsonb_build_object('mine',r.claimed_by=actor,'holderName',case when r.claimed_by=actor then 'you' else 'another moderator' end,
        'expiresAt',r.claim_expires_at,'generation',case when r.claimed_by=actor then r.claim_generation::text end,
        'nonce',case when r.claimed_by=actor then r.claim_nonce end);
      if r.claimed_by=actor then
        -- This checks capability, fresh TOTP, independence and the exact live
        -- lease before any submitted body, private fields or media are read.
        perform internal.staff_review_post(r.id,r.claim_generation::text,r.claim_nonce);
        review:=internal.frontend_owner_post(r.id,r.owner_id);
        if r.edit_of is not null then live:=internal.frontend_owner_post(r.edit_of,r.owner_id);end if;
      end if;
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'kind',r.kind,'area',r.area,'category',r.category_key,
      'title',r.title,'created_at',r.created_at,'updated_at',r.content_updated_at,'revision',r.revision,'edit_of',r.edit_of,
      'owner_id',case when review is not null then r.owner_id end,'claim',claim,'review',review,'live',live));
  end loop;
  perform internal.staff_actor('queue:view');
  return jsonb_build_object('account_id',actor,'total',total,'my_claims',held,'items',rows);
end$function$;
alter function internal.get_frontend_staff_moderation_queue(text,integer) owner to postgres;
revoke all on function internal.get_frontend_staff_moderation_queue(text,integer) from public;
grant execute on function internal.get_frontend_staff_moderation_queue(text,integer) to authenticated;
