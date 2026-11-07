-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.snapshot_identity_submission_names()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare first_name text; last_name text;
begin
  select p.legal_first_name,p.legal_last_name into first_name,last_name
    from private.profiles p where p.account_id=new.owner_id for share;
  if first_name is null then
    raise exception 'legal name required before identity submission'
      using errcode='PT409',detail='legal_name_required'; end if;
  insert into private.identity_submission_names(submission_id,owner_id,legal_first_name,legal_last_name)
    values(new.id,new.owner_id,first_name,last_name);
  return new;
end;
$function$;
alter function internal.snapshot_identity_submission_names() owner to postgres;
revoke all on function internal.snapshot_identity_submission_names() from public;
