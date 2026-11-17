-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_post_contacts_ready(p_post_id uuid, p_staff boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; chosen text[]; has_phone boolean; actor uuid;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select * into post from private.posts p where p.id=p_post_id;
  select c.channels into chosen from private.post_contacts c where c.post_id=p_post_id;
  select exists(select 1 from private.verification_phone_proofs f
    where f.owner_id=post.owner_id and f.revoked_at is null) into has_phone;
  -- Derive the real caller again before any data-dependent refusal, including
  -- combined caller/phone loss during earlier post/media/projection waits.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if post.id is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if not p_staff and post.owner_id<>actor then
    raise exception 'owned post required' using errcode='42501';
  end if;
  if post.kind='business' then return; end if;
  if chosen is null or cardinality(chosen)=0 then
    raise exception 'choose at least one contact channel' using errcode='22023',detail='contact_channels_required';
  end if;
  if chosen && array['call','whatsapp'] and not has_phone then
    raise exception 'verify your account phone for selected contact channels' using errcode='PT409',detail='contact_phone_required';
  end if;
end;$function$;
alter function internal.assert_post_contacts_ready(uuid,boolean) owner to postgres;
revoke all on function internal.assert_post_contacts_ready(uuid,boolean) from public;
