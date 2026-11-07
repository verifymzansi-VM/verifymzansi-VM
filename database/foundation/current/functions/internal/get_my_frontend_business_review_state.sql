-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_business_review_state(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();base jsonb;sticker jsonb;cases jsonb;links jsonb;
begin
  base:=internal.get_my_frontend_business_checks(p_business);
  select jsonb_build_object('verifiedAt',s.decided_at,'expiresAt',s.expires_at,'registrationNumber',s.registration_number,
    'registeredName',s.registered_name,'role',s.accepted_role,'position',s.position_title,'showFullRegisteredOffice',s.display_full_office,
    'registeredOffice',s.registered_office) into sticker from private.frontend_current_cipc_stickers s where s.business_id=p_business and s.owner_id=actor;
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'status',case when x.revoked_at is not null then 'revoked' else x.status end,
    'route',d.route,'registrationNumber',d.registration_number,'reasonCode',x.reason_code,'note',x.review_note,
    'createdAt',x.created_at,'decidedAt',x.decided_at,'expiresAt',x.expires_at,'seenMethod',x.seen_method,'seenScheduledFor',x.scheduled_for,
    'representative',case when d.route='representative' then jsonb_build_object('email',d.representative_email,'position',d.representative_position,
      'emailVerified',d.representative_verified_at is not null,'codeSent',exists(select 1 from private.frontend_cipc_email_codes code where code.check_id=x.id and code.sent_at is not null)) end,
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',case m.author_role when 'owner' then 'You' else 'VerifyMzansi team' end,
      'mine',m.author_role='owner','body',m.body,'createdAt',m.created_at) order by m.created_at,m.id)
      from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb))
    order by x.created_at desc,x.id desc),'[]'::jsonb) into cases
    from (select b.* from private.frontend_business_checks b left join private.frontend_cipc_reviews d0 on d0.check_id=b.id
      where b.business_id=p_business and b.owner_id=actor and (b.kind='seen' or d0.submitted_at is not null)
      order by b.created_at desc,b.id desc limit 20)x left join private.frontend_cipc_reviews d on d.check_id=x.id;
  select coalesce(jsonb_agg(jsonb_build_object('businessId',x.business_id,'businessName',x.title,'registrationNumber',x.registration_number,'registeredName',x.registered_name)
    order by x.title,x.business_id),'[]'::jsonb) into links from (
      select s.business_id,coalesce(p.title,'Business') title,s.registration_number,s.registered_name
      from private.frontend_current_cipc_stickers s join private.posts p on p.id=s.business_id
      where s.owner_id=actor and s.business_id<>p_business order by p.title,s.business_id limit 100)x;
  perform internal.price_draft_actor();
  return jsonb_set(base,'{stickers,cipc}',coalesce(sticker,'null'::jsonb))||jsonb_build_object('cases',cases,'linkable',links);
end$function$;
alter function internal.get_my_frontend_business_review_state(uuid) owner to postgres;
revoke all on function internal.get_my_frontend_business_review_state(uuid) from public;
grant execute on function internal.get_my_frontend_business_review_state(uuid) to authenticated;
