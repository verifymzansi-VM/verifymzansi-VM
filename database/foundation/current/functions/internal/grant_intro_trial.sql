-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.grant_intro_trial(p_owner uuid, p_identity_hmac text, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare ent uuid;
begin
  if p_days not in (7, 30) then raise exception 'invalid trial length' using errcode = '22023'; end if;
  if p_owner is null or p_identity_hmac is null or p_identity_hmac !~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$' or p_days is null then
    raise exception 'owner, identity fingerprint and trial length required' using errcode='22023';
  end if;
  -- Account closure uses this same subject guard. A grant must either finish
  -- before closure detaches it, or observe closure and leave no attached row.
  perform internal.lock_evidence_subject(p_owner);
  -- Concurrent grants for one identity serialise here; the loser sees the claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(p_identity_hmac, ''), 2701));
  if not exists (select 1 from private.current_account_access a where a.id=p_owner) then
    raise exception 'active trial owner required' using errcode='42501';
  end if;
  if exists (select 1 from private.trial_identities t where t.identity_hmac = p_identity_hmac) then
    return jsonb_build_object('granted', false, 'reason', 'identity_already_used');
  end if;
  -- Banned identities (trust-governance.sql) get no trial while the ban is kept.
  if exists (select 1 from private.banned_identities b where b.identity_hmac = p_identity_hmac and b.retain_until>clock_timestamp()) then
    return jsonb_build_object('granted', false, 'reason', 'identity_banned');
  end if;
  insert into private.entitlements (owner_id, source, slot_capacity, max_photos, max_videos, starts_at, ends_at)
  values (p_owner, 'intro_trial', 1, 10, 1, statement_timestamp(), statement_timestamp() + make_interval(days => p_days))
  returning id into ent;
  insert into private.trial_identities (identity_hmac, owner_id, entitlement_id) values (p_identity_hmac, p_owner, ent);
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  -- The fingerprint lives only in trial_identities (DEC-27); other copies would
  -- outlive its purge, so effects are keyed by the trial's entitlement.
  values ('trial_started', ent, p_owner, 'trial_started:' || ent);
  return jsonb_build_object('granted', true, 'entitlement_id', ent);
end;
$function$;
alter function internal.grant_intro_trial(uuid,text,integer) owner to postgres;
revoke all on function internal.grant_intro_trial(uuid,text,integer) from public;
