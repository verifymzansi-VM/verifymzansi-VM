-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_my_identity_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); k private.identity_checks; opened jsonb; route jsonb; now_at timestamptz;
begin
  perform internal.lock_verification_subject(actor);
  actor:=internal.price_draft_actor();
  now_at:=clock_timestamp();
  select x.* into k from private.identity_checks x where x.owner_id=actor and x.status='started' for update;
  if found then
    if k.expires_at>now_at then
      return jsonb_build_object('check_id',k.id,'session_id',k.session_id,'session_url',k.session_url,'created',false); end if;
    update private.identity_checks set status='not_finished',finished_at=now_at,
      provider_delete_due=case when session_id is not null then now_at end where id=k.id;
  end if;
  if exists(select 1 from private.identity_checks x where x.owner_id=actor and internal.identity_check_with_person(x)) then
    raise exception 'a person is checking your identity' using errcode='PT409',detail='identity_check_with_person'; end if;
  if not exists(select 1 from private.profiles p where p.account_id=actor
      and p.legal_first_name is not null and p.legal_last_name is not null) then
    raise exception 'legal name required' using errcode='PT409',detail='legal_name_required'; end if;
  opened:=internal.open_verification_case();
  if (opened->>'read_only')::boolean then
    raise exception 'identity is accepted or under independent review' using errcode='PT409'; end if;
  -- One start at a time site-wide, so the daily count holds exactly.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('identity_check_start',0));
  route:=internal.identity_check_route(actor);
  if route->>'reason'='limit' then
    raise exception 'automatic identity check limit reached' using errcode='PT409',detail='identity_check_limit';
  elsif route->>'reason'='paused' then
    raise exception 'automatic identity checks are paused' using errcode='PT409',detail='identity_check_paused';
  elsif route->>'route'<>'automatic' then
    raise exception 'automatic identity checks are off' using errcode='PT409',detail='identity_check_mode'; end if;
  now_at:=clock_timestamp();
  insert into private.identity_checks(owner_id,case_id,created_at,expires_at)
    values(actor,(opened->>'case_id')::uuid,now_at,now_at+interval '24 hours') returning * into k;
  perform internal.price_draft_actor();
  return jsonb_build_object('check_id',k.id,'session_id',null,'session_url',null,'created',true);
end$function$;
alter function internal.start_my_identity_check() owner to postgres;
revoke all on function internal.start_my_identity_check() from public;
grant execute on function internal.start_my_identity_check() to authenticated;
