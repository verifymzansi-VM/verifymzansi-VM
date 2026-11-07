-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_reviewed_legal_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare first_name text; last_name text;
begin
  -- A fact recorded as already revoked is history, not an acceptance.
  if new.revoked_at is not null then return new; end if;
  select n.legal_first_name,n.legal_last_name into first_name,last_name
    from private.identity_submission_names n where n.submission_id=new.submission_id and n.owner_id=new.owner_id;
  if not found then
    raise exception 'reviewed legal name unavailable' using errcode='PT409',detail='legal_name_required'; end if;
  insert into private.profiles(account_id) values(new.owner_id) on conflict(account_id) do nothing;
  update private.profiles set legal_first_name=first_name,legal_last_name=last_name,
    display_name=first_name||' '||last_name,legal_name_locked_at=clock_timestamp(),legal_name_fact_id=new.id,
    revision=revision+1,updated_at=statement_timestamp()
  where account_id=new.owner_id and revision<2147483647;
  if not found then raise exception 'profile revision exhausted' using errcode='22023'; end if;
  return new;
end;
$function$;
alter function internal.lock_reviewed_legal_name() owner to postgres;
revoke all on function internal.lock_reviewed_legal_name() from public;
