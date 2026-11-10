-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_intro_trial()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); fingerprint text; running private.entitlements; result jsonb;
begin
  select e.* into running from private.entitlements e
    where e.owner_id=actor and e.source='intro_trial' and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
    order by e.ends_at desc,e.id limit 1;
  fingerprint:=internal.current_verified_identity(actor);
  result:=jsonb_build_object('status',case
      when running.id is not null then 'running'
      when internal.intro_trial_waiting(actor) then 'awaiting_approval'
      when exists(select 1 from private.trial_identities t where t.owner_id=actor or t.identity_hmac=fingerprint) then 'used'
      when exists(select 1 from private.banned_identities b where b.identity_hmac=fingerprint and b.retain_until>clock_timestamp()) then 'unavailable'
      else 'available' end,
    'starts_at',running.starts_at,'ends_at',running.ends_at);
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_intro_trial() owner to postgres;
revoke all on function internal.get_my_intro_trial() from public;
grant execute on function internal.get_my_intro_trial() to authenticated;
