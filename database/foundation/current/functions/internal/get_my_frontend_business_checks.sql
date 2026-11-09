-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_business_checks(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.get_my_frontend_business_checks(uuid) owner to postgres;
revoke all on function internal.get_my_frontend_business_checks(uuid) from public;
grant execute on function internal.get_my_frontend_business_checks(uuid) to authenticated;
