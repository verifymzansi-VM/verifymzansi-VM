-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.consume_frontend_post_command(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); command private.frontend_post_commands; input jsonb;
  post private.posts; created jsonb; changed jsonb; terms jsonb; answer jsonb; trial jsonb; rev integer; target uuid; wants_edit boolean:=false;original_status text;
begin
  perform internal.lock_verification_subject(actor);
  perform internal.price_draft_actor();
  select * into command from private.frontend_post_commands where owner_id=actor and request_id=p_request for update;
  if not found then raise exception 'validated owner form required' using errcode='42501'; end if;
  if command.result is not null then return command.result; end if;
  if command.expires_at<=clock_timestamp() then raise exception 'form request expired' using errcode='PT409'; end if;
  input:=command.payload;
  if input->'presentation'->>'business_id' is not null and not exists(select 1 from private.posts b
    where b.id=(input->'presentation'->>'business_id')::uuid and b.kind='business' and b.owner_id=actor and b.edit_of is null) then
    raise exception 'linked business must belong to the current member' using errcode='42501'; end if;
  if input->>'target_id' is null then
      if input->>'terms_accepted' is distinct from 'true' then raise exception 'explicit posting consent required' using errcode='22023'; end if;
      perform internal.accept_posting_terms(input->'terms'->>'version',input->'terms'->>'document_hash');
    else
      if not exists(select 1 from private.posting_terms_current c join private.posting_terms_versions v on v.version=c.version
        join private.posting_terms_acceptances a on a.owner_id=actor and a.version=v.version and a.document_hash=v.document_hash
        where v.version=input->'terms'->>'version' and v.document_hash=input->'terms'->>'document_hash') then
        raise exception 'review and accept the current posting terms before editing' using errcode='PT409',detail='posting_terms_required'; end if;
    end if;
  target:=(input->>'target_id')::uuid;
  if target is not null then
    select * into post from private.posts where id=target and owner_id=actor for update;
    if not found or post.kind is distinct from input->'context'->>'kind' or post.area is distinct from input->'context'->>'area'
      or post.edit_of is not null then raise exception 'owned post unavailable' using errcode='42501'; end if;
    if post.revision is distinct from (input->>'expected_revision')::integer then raise exception 'post changed; reload before saving' using errcode='PT409'; end if;
    original_status:=post.status; if post.status='live' then
      created:=internal.create_post_edit(post.id,post.revision);target:=(created->>'id')::uuid;wants_edit:=true;
    elsif post.status in('expired','sold') then update private.posts set status='paused',revision=revision+1 where id=post.id returning * into post;
     elsif post.status not in('draft','rejected','paused') then
      raise exception 'post cannot be edited now' using errcode='PT409'; end if;
  else
    created:=internal.create_core_draft(input->'context'->>'kind',input->'context'->>'area',input->'context'->>'category',input->'detail',input->'context'->>'activity');
    target:=(created->>'id')::uuid;
  end if;
  select * into post from private.posts where id=target and owner_id=actor for update;
  if (post.category_key,post.activity_key) is distinct from (input->'context'->>'category',input->'context'->>'activity') then
    if not exists(select 1 from private.categories c where c.key=input->'context'->>'category' and c.kind=post.kind and c.area=post.area)
      or (input->'context'->>'activity' is not null and not exists(select 1 from private.category_activities a where a.category_key=input->'context'->>'category' and a.key=input->'context'->>'activity')) then
      raise exception 'category or activity unavailable' using errcode='22023'; end if;
    update private.posts set category_key=input->'context'->>'category',activity_key=input->'context'->>'activity',revision=revision+1 where id=post.id returning * into post;
  end if;
  changed:=internal.save_post_content(post.id,post.revision,input->'content');rev:=(changed->>'revision')::integer;
  if post.kind='listing' then
    terms:=internal.validated_listing_terms(post.category_key,input->'listing_terms');
    update private.listing_details set price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
      price_negotiable=(terms->>'price_negotiable')::boolean where post_id=post.id;
    update private.posts set revision=revision+1 where id=post.id returning revision into rev;
    changed:=internal.save_listing_attributes(post.id,rev,input->'attributes');rev:=(changed->>'revision')::integer;
  elsif post.kind='business' then
    changed:=internal.save_business_event_context(post.id,rev,jsonb_build_object('business_type',input->'business_type'));
    rev:=(changed->>'revision')::integer;
  elsif input ? 'target_id' then
    changed:=internal.save_business_event_context(post.id,rev,jsonb_build_object('event_window',(input->'detail')-'contact_channels'));
    rev:=(changed->>'revision')::integer;
  end if;
  if post.kind in('listing','event') then
    changed:=internal.set_post_contacts(post.id,rev,input->'detail'->'contact_channels');rev:=(changed->>'revision')::integer;
  end if;
  -- All references are journalled before submission. Extra venue/logo/poster
  -- images have separate bounded slots and do not consume gallery places.
  perform internal.save_frontend_post_presentation(post.id,input->'presentation',coalesce(input->'contacts','{}'::jsonb),input->'presentation_media');
  changed:=internal.set_post_media(post.id,rev,input->'media');rev:=(changed->>'revision')::integer;
  if input->>'target_id' is not null and not wants_edit then
       if original_status in('expired','sold') then update private.posts set status=original_status,revision=revision+1 where id=post.id returning revision into rev;end if;
       answer:=jsonb_build_object('id',post.id,'status',original_status,'revision',rev);
     else begin
    answer:=internal.submit_post(post.id,rev);
  exception when sqlstate 'PT402' then
    if post.kind='event' or wants_edit or input->>'trial_days' is null then raise; end if;
    trial:=internal.grant_verified_intro_trial(actor,(input->>'trial_days')::integer);
    if not coalesce((trial->>'granted')::boolean,false) then raise exception 'an active posting plan is required' using errcode='PT402'; end if;
    answer:=internal.submit_post(post.id,rev);
  end;
  end if; answer:=answer||jsonb_build_object('original_id',coalesce(post.edit_of,post.id),'edit_of',post.edit_of);
  update private.frontend_post_commands set result=answer,payload=null where owner_id=actor and request_id=p_request;
  perform internal.price_draft_actor();
  return answer;
end$function$;
alter function internal.consume_frontend_post_command(uuid) owner to postgres;
revoke all on function internal.consume_frontend_post_command(uuid) from public;
grant execute on function internal.consume_frontend_post_command(uuid) to authenticated;
