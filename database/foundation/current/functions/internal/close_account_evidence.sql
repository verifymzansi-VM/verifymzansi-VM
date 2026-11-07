-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.close_account_evidence(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare closure private.account_closures; scheduled integer; trial_fingerprints integer;
begin
  perform internal.lock_evidence_subject(p_user_id);
  perform e.id from private.evidence_cases e where e.subject_id=p_user_id order by e.id for update;
  insert into private.account_closures (user_id, closed_at, evidence_delete_after)
  values (p_user_id, statement_timestamp(), statement_timestamp() + interval '90 days')
  on conflict (user_id) do nothing;
  select * into closure from private.account_closures x where x.user_id = p_user_id;
  update private.evidence_artifacts a
    set retain_until = least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after)
  where a.owner_id = p_user_id and a.state in ('uploaded', 'clean', 'rejected')
    and a.retain_until is distinct from least(coalesce(a.retain_until,'infinity'::timestamptz), closure.evidence_delete_after);
  get diagnostics scheduled = row_count;
  -- DEC-27: detach the trial fingerprint and keep it 3 years after closure.
  update private.trial_identities set owner_id = null, entitlement_id = null,
    detached_at = closure.closed_at, retain_until = closure.closed_at + interval '3 years'
  where owner_id = p_user_id;
  get diagnostics trial_fingerprints = row_count;
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end;
$function$;
alter function internal.close_account_evidence(uuid) owner to postgres;
revoke all on function internal.close_account_evidence(uuid) from public;
grant execute on function internal.close_account_evidence(uuid) to service_role;
