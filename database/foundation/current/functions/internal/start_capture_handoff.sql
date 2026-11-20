-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_capture_handoff(p_token_sha256 text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_with_id boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); opened jsonb; profile private.profiles;
  made timestamptz; h private.capture_handoffs;
begin
  if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'phone link token required' using errcode='22023'; end if;
  if p_with_id is null or (p_first_name is null)<>(p_last_name is null) or (p_first_name is not null)<>p_with_id then
    raise exception 'names and ID details come together' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  if (select count(*) from private.capture_handoffs x where x.owner_id=actor
      and x.created_at>clock_timestamp()-interval '1 hour')>=5 then
    raise exception 'too many phone links' using errcode='PT429',detail='handoff_rate_limited'; end if;
  if exists(select 1 from private.capture_handoffs x where x.token_sha256=p_token_sha256) then
    raise exception 'phone link token already used' using errcode='PT409'; end if;
  if p_first_name is not null then
    select * into profile from private.profiles where account_id=actor for update;
    if (profile.legal_first_name,profile.legal_last_name) is distinct from (p_first_name,p_last_name) then
      perform internal.save_my_legal_name(profile.revision,p_first_name,p_last_name);
    end if;
  end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  if not p_with_id and internal.capture_handoff_prior_id(actor,(opened->>'case_id')::uuid) is null then
    raise exception 'ID details required' using errcode='PT409',detail='handoff_needs_id'; end if;
  made:=clock_timestamp();
  insert into private.capture_handoffs(token_sha256,owner_id,case_id,session_id,created_at,expires_at,expects_id)
    values(p_token_sha256,actor,(opened->>'case_id')::uuid,(auth.jwt()->>'session_id')::uuid,made,
      made+interval '15 minutes',p_with_id)
    returning * into h;
  perform internal.price_draft_actor();
  return jsonb_build_object('expires_at',h.expires_at,'needs_id',h.expects_id);
end;
$function$;
alter function internal.start_capture_handoff(text,text,text,boolean) owner to postgres;
revoke all on function internal.start_capture_handoff(text,text,text,boolean) from public;
grant execute on function internal.start_capture_handoff(text,text,text,boolean) to authenticated;
