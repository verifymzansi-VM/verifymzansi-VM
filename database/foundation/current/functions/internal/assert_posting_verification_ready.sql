-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.assert_posting_verification_ready(p_post_id uuid, p_staff boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; owner uuid; ready boolean;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select p.owner_id into owner from private.posts p where p.id=p_post_id;
  ready:=internal.current_verified_identity(owner) is not null;
  -- No new verification/evidence locks beneath post/media locks. Read canonical
  -- current facts and rederive the real caller before a data-dependent refusal.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if owner is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if (not p_staff and owner<>actor) or (p_staff and owner=actor) then
    raise exception 'caller cannot publish this post' using errcode='42501';
  end if;
  if not ready then
    raise exception 'complete identity verification before posting' using errcode='42501',
      detail='posting_verification_required';
  end if;
end;
$function$;
alter function internal.assert_posting_verification_ready(uuid,boolean) owner to postgres;
revoke all on function internal.assert_posting_verification_ready(uuid,boolean) from public;
