-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_enquiry(p_request_id uuid, p_post_id uuid, p_sender uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; e private.enquiries; confirmed boolean:=false; channels text[];
begin
  if p_request_id is null or p_post_id is null
    or (p_buyer_name is not null and not internal.plain_text_valid(p_buyer_name,2,80,false))
    or not internal.enquiry_email_valid(p_buyer_email)
    or (p_buyer_phone is not null and p_buyer_phone !~ '^[+]27[0-9]{9}$')
    or not internal.plain_text_valid(p_message,10,1000,true) then
    raise exception 'enquiry details are invalid' using errcode='22023',detail='enquiry_invalid'; end if;
  select x.* into e from private.enquiries x where x.request_id=p_request_id;
  if found then
    if (e.post_id,e.sender_account_id,e.buyer_name,e.buyer_email,e.buyer_phone,e.message)
      is distinct from (p_post_id,p_sender,p_buyer_name,p_buyer_email,p_buyer_phone,p_message) then
      raise exception 'request reused for a different enquiry' using errcode='PT409',detail='enquiry_request_conflict'; end if;
    return jsonb_build_object('id',e.id,'reused',true);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('enquiry:'||p_post_id::text,0));
  select p.* into post from private.posts p where p.id=p_post_id for share;
  if not found or not exists(select 1 from private.public_eligible_posts x where x.id=p_post_id)
    or not exists(select 1 from private.post_search_documents d where d.post_id=p_post_id and d.is_visible
      and (d.visible_until is null or d.visible_until>statement_timestamp())) then
    raise exception 'post unavailable' using errcode='PT404',detail='post_unavailable'; end if;
  if post.kind='event' then
    select c.channels into channels from private.post_contacts c where c.post_id=post.id;
    if channels is null or not 'form'=any(channels) then
      raise exception 'enquiries are not enabled for this post' using errcode='PT403',detail='enquiries_disabled'; end if;
  end if;
  if p_sender is not null then
    if not exists(select 1 from private.current_account_access a where a.id=p_sender) then
      raise exception 'sender account is not active' using errcode='42501',detail='sender_inactive'; end if;
    if p_sender=post.owner_id then
      raise exception 'owners cannot enquire on their own post' using errcode='22023',detail='own_post'; end if;
    confirmed:=exists(select 1 from auth.users u where u.id=p_sender and u.email_confirmed_at is not null
      and lower(u.email)=p_buyer_email);
  end if;
  if (select count(*) from private.enquiries x where x.post_id=post.id and x.buyer_email=p_buyer_email
        and x.created_at>statement_timestamp()-interval '24 hours')>=3
    or (select count(*) from private.enquiries x where x.post_id=post.id
        and x.created_at>statement_timestamp()-interval '24 hours')>=100
    or (select count(*) from private.enquiries x where x.buyer_email=p_buyer_email
        and x.created_at>statement_timestamp()-interval '1 hour')>=10 then
    raise exception 'too many enquiries; try again later' using errcode='PT429',detail='enquiry_limit'; end if;
  insert into private.enquiries(request_id,post_id,owner_id,sender_account_id,buyer_name,buyer_email,email_confirmed,
    buyer_phone,message,retain_until)
  values(p_request_id,post.id,post.owner_id,p_sender,p_buyer_name,p_buyer_email,confirmed,p_buyer_phone,p_message,
    statement_timestamp()+interval '12 months')
  returning * into e;
  insert into private.notifications(account_id,kind,subject_id,post_id) values(post.owner_id,'enquiry_received',e.id,post.id);
  insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
    values('enquiry_received',e.id,post.owner_id,'enquiry_received:'||e.id::text);
  perform internal.signal_owner_inbox(post.owner_id);
  return jsonb_build_object('id',e.id,'reused',false);
end;
$function$;
alter function internal.submit_enquiry(uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function internal.submit_enquiry(uuid,uuid,uuid,text,text,text,text) from public;
grant execute on function internal.submit_enquiry(uuid,uuid,uuid,text,text,text,text) to service_role;
