-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.bind_native_restriction_for_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
    select new.id,c.subject_id,'ban','Account restricted after an independent review.',false,new.approved_at
    from private.evidence_cases c where c.id=new.case_id;
  return new;
end$function$;
alter function internal.bind_native_restriction_for_review() owner to postgres;
revoke all on function internal.bind_native_restriction_for_review() from public;
