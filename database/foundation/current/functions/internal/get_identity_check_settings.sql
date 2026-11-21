-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_identity_check_settings()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view'); s private.identity_check_settings; counts jsonb; changes jsonb;
begin
  select x.* into s from private.identity_check_settings x where x.id;
  select jsonb_build_object('checks',count(*) filter(where k.status<>'unavailable'),
      'approved',count(*) filter(where k.status='approved'),'with_staff',count(*) filter(where k.status='with_staff'),
      'declined',count(*) filter(where k.status='declined'),
      'asked_person',count(*) filter(where k.asked_at is not null),
      'unavailable',count(*) filter(where k.status='unavailable'))
    into counts from private.identity_checks k where k.created_at>clock_timestamp()-interval '7 days';
  select coalesce(jsonb_agg(jsonb_build_object('from_mode',e.from_mode,'to_mode',e.to_mode,'changed_by',e.changed_by,
      'reason',e.reason,'changed_at',e.changed_at) order by e.changed_at desc,e.id desc),'[]'::jsonb)
    into changes from (select * from private.identity_check_mode_events x order by x.changed_at desc,x.id desc limit 5) e;
  return jsonb_build_object('account_id',actor,'mode',s.mode,'changed_at',s.changed_at,
    'paused_until',case when s.paused_until>clock_timestamp() then s.paused_until end,
    'pause_reason',case when s.paused_until>clock_timestamp() then s.pause_reason end,
    'last_7_days',counts,'recent_changes',changes);
end$function$;
alter function internal.get_identity_check_settings() owner to postgres;
revoke all on function internal.get_identity_check_settings() from public;
grant execute on function internal.get_identity_check_settings() to authenticated;
