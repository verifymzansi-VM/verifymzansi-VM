-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.report_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if (new.id,new.report_origin,new.subject_account_id,new.category,new.severity,new.description,
      new.reporter_ip_hmac,new.created_at,new.duplicate_post_a,new.duplicate_post_b,
      new.duplicate_revision_a,new.duplicate_revision_b,new.duplicate_owner_b,new.duplicate_created_by)
    is distinct from
    (old.id,old.report_origin,old.subject_account_id,old.category,old.severity,old.description,
      old.reporter_ip_hmac,old.created_at,old.duplicate_post_a,old.duplicate_post_b,
      old.duplicate_revision_a,old.duplicate_revision_b,old.duplicate_owner_b,old.duplicate_created_by)
    or (new.post_id is distinct from old.post_id and new.post_id is not null)
    or (new.reporter_id is distinct from old.reporter_id and new.reporter_id is not null) then
    raise exception 'report identity and original statement are immutable' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.report_identity_guard() owner to postgres;
revoke all on function internal.report_identity_guard() from public;
