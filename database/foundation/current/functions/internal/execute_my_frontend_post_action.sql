-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.execute_my_frontend_post_action(p_request uuid, p_post uuid, p_expected_revision integer, p_action text, p_kind text, p_area text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();post private.posts;prior private.frontend_post_action_receipts;
  result jsonb;submitted jsonb;funded_until timestamptz;current_digest text;unchanged boolean:=false;
begin
  if p_request is null or p_post is null or p_action is null or p_action not in('delete','resubmit','deactivate','mark_sold','reactivate')
    or p_kind is null or p_kind not in('listing','business','event') or p_area is null or p_area not in('market','business','tourism_events') then
    raise exception 'bounded owner action required' using errcode='22023';end if;
  perform internal.assert_post_revision(p_expected_revision);
  perform internal.lock_verification_subject(actor);
  if p_action in('reactivate','resubmit') and exists(select 1 from private.frontend_content_holds h join private.posts p on p.id=h.post_id where p.id=p_post and p.owner_id=actor and h.released_at is null) then raise exception 'staff visibility hold requires independent release' using errcode='PT423',detail='staff_visibility_hold';end if;
  select * into prior from private.frontend_post_action_receipts where owner_id=actor and request_id=p_request;
  if found then
    if (prior.post_id,prior.expected_revision,prior.action,prior.kind,prior.area) is distinct from (p_post,p_expected_revision,p_action,p_kind,p_area) then
      raise exception 'action receipt changed' using errcode='PT409';end if;
    perform internal.price_draft_actor();return prior.result;
  end if;
  select * into post from private.posts p where p.id=p_post and p.owner_id=actor for update;
  if not found or post.edit_of is not null or post.kind<>p_kind or post.area<>p_area then raise exception 'owned post unavailable' using errcode='42501';end if;
  if post.revision<>p_expected_revision then raise exception 'post changed; reload before continuing' using errcode='PT409';end if;
  if p_action='delete' then
    if exists(select 1 from private.legal_holds h where h.subject_id=actor and h.released_at is null) then raise exception 'post is held for review' using errcode='PT409';end if;
    perform internal.delete_post(post.id,post.revision);
    result:=jsonb_build_object('id',post.id,'status','deleted','success',true);
  elsif p_action in('deactivate','mark_sold') then
    result:=internal.set_post_state(post.id,post.revision,case p_action when 'deactivate' then 'pause' else 'sold' end)||jsonb_build_object('success',true);
  else
    if post.status not in('draft','rejected','paused','expired','sold') and not(post.status='live' and post.visible_until<=clock_timestamp()) then
      raise exception 'this post cannot be resubmitted now' using errcode='PT409';end if;
    if p_action='reactivate' then
      current_digest:=internal.frontend_post_approval_digest(post.id);
      unchanged:=post.status not in('draft','rejected') and exists(select 1 from private.frontend_post_approval_snapshots s where s.post_id=post.id and s.digest=current_digest);
    end if;
    if post.status in('expired','sold','live') then
      update private.posts set status='paused',revision=revision+1 where id=post.id returning * into post;
    end if;
    submitted:=internal.submit_post(post.id,post.revision);
    if p_action='reactivate' and unchanged then
      if internal.frontend_post_approval_digest(post.id) is distinct from current_digest then raise exception 'approved content changed' using errcode='PT409';end if;
      select f.funded_until into funded_until from internal.post_funding(post.id) f;
      if funded_until is null or funded_until<=clock_timestamp() then raise exception 'current posting funding required' using errcode='PT402';end if;
      update private.posts set status='live',status_reason=null,revision=revision+1,visible_until=funded_until,
        published_at=coalesce(published_at,statement_timestamp()) where id=post.id returning * into post;
      perform internal.write_post_projection(post.id);
      perform internal.assert_post_contacts_ready(post.id,false);
      perform internal.assert_posting_verification_ready(post.id,false);
      result:=jsonb_build_object('id',post.id,'status','live','revision',post.revision,'success',true);
    else result:=submitted||jsonb_build_object('success',true);end if;
  end if;
  perform internal.price_draft_actor();
  insert into private.frontend_post_action_receipts(owner_id,request_id,post_id,expected_revision,action,kind,area,result)
    values(actor,p_request,p_post,p_expected_revision,p_action,p_kind,p_area,result);
  return result;
end$function$;
alter function internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) owner to postgres;
revoke all on function internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) from public;
grant execute on function internal.execute_my_frontend_post_action(uuid,uuid,integer,text,text,text) to authenticated;
