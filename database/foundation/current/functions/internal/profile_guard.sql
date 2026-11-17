-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.profile_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op='UPDATE' then
    if new.account_id<>old.account_id or new.created_at<>old.created_at then
      raise exception 'profile identity is immutable' using errcode='23514'; end if;
    if old.legal_name_locked_at is not null and new.legal_name_locked_at is null then
      raise exception 'verified legal name lock cannot be removed' using errcode='23514'; end if;
    if old.legal_name_locked_at is not null and new.legal_name_fact_id=old.legal_name_fact_id
      and (new.legal_first_name,new.legal_last_name,new.display_name,new.legal_name_locked_at)
        is distinct from (old.legal_first_name,old.legal_last_name,old.display_name,old.legal_name_locked_at) then
      raise exception 'verified legal name is locked' using errcode='23514'; end if;
  end if;
  if new.legal_name_locked_at is not null and (tg_op='INSERT'
    or new.legal_name_fact_id is distinct from old.legal_name_fact_id) then
    if not exists(select 1 from private.accepted_identity_facts f
        join private.identity_submission_names n on n.submission_id=f.submission_id and n.owner_id=f.owner_id
        where f.id=new.legal_name_fact_id and f.owner_id=new.account_id and f.revoked_at is null
          and n.legal_first_name=new.legal_first_name and n.legal_last_name=new.legal_last_name)
      or new.display_name is distinct from new.legal_first_name||' '||new.legal_last_name then
      raise exception 'legal name lock requires accepted identity names' using errcode='23514'; end if;
  end if;
  return new;
end;
$function$;
alter function internal.profile_guard() owner to postgres;
revoke all on function internal.profile_guard() from public;
