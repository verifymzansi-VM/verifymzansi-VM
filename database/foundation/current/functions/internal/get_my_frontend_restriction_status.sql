-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_frontend_restriction_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.frontend_self_review_actor();now_at timestamptz:=clock_timestamp();ends timestamptz;result_status text;
begin
  if exists(select 1 from private.current_account_access where id=actor) then result_status:='active';
  elsif exists(select 1 from private.decisions d join private.evidence_cases c on c.id=d.case_id
    where c.subject_id=actor and d.status='approved' and d.action='restrict_account' and d.scope_kind='native' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency))
    or exists(select 1 from private.frontend_account_restrictions x where x.account_id=actor and x.kind='ban' and x.lifted_at is null)
    then result_status:='banned';
  else
    select max(x.ends_at) into ends from private.frontend_account_restrictions x where x.account_id=actor and x.kind='suspension'
      and x.lifted_at is null and x.ends_at>now_at;
    if ends is null then raise exception 'current restriction unavailable' using errcode='42501';end if;
    result_status:='suspended';
  end if;
  return jsonb_build_object('account_id',actor,'status',result_status,'ends_at',ends);
end$function$;
alter function internal.get_my_frontend_restriction_status() owner to postgres;
revoke all on function internal.get_my_frontend_restriction_status() from public;
grant execute on function internal.get_my_frontend_restriction_status() to authenticated;
