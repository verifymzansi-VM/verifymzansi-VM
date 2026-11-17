-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.decision_binding_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    if current_setting('vm.retention',true)='on' and old.status<>'proposed' then return old; end if;
    raise exception 'decisions are retained' using errcode = '23514';
  end if;
  if (new.id,new.case_id, new.action, new.payload, new.case_version, new.reviewed_snapshot, new.proposed_by, new.proposed_at,new.scope_kind,new.suspension_days)
     is distinct from (old.id,old.case_id, old.action, old.payload, old.case_version, old.reviewed_snapshot, old.proposed_by, old.proposed_at,old.scope_kind,old.suspension_days)
    or old.status <> 'proposed' then
    raise exception 'decision is bound to its proposal' using errcode = '23514';
  end if;
  return new;
end;
$function$;
alter function internal.decision_binding_guard() owner to postgres;
revoke all on function internal.decision_binding_guard() from public;
