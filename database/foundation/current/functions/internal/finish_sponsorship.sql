-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.finish_sponsorship(p_id uuid, p_status text, p_reason text, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare s private.organisation_sponsorships;
begin
  select * into s from private.organisation_sponsorships where id=p_id for update nowait;
  if not found or s.status not in('active','waitlisted') then return false; end if;
  perform internal.release_sponsorship_entitlement(s.entitlement_id);
  update private.organisation_sponsorships set status=p_status,ended_at=statement_timestamp(),ended_by=p_actor,
    end_reason=p_reason where id=s.id;
  if s.status='active' then
    perform internal.notify_account(s.owner_id,'organisation_sponsorship_ended',s.id,s.post_id,s.organisation_id);
  end if;
  return s.status='active';
exception when lock_not_available then
  raise exception 'sponsorship is busy; retry the operation' using errcode='PT409',detail='sponsorship_busy';
end;
$function$;
alter function internal.finish_sponsorship(uuid,text,text,uuid) owner to postgres;
revoke all on function internal.finish_sponsorship(uuid,text,text,uuid) from public;
