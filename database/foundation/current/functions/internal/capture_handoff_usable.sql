-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.capture_handoff_usable(p_handoff private.capture_handoffs, p_used boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_handoff.token_sha256 is not null
    and (p_handoff.used_at is not null)=p_used
    and (not p_handoff.expects_id or p_handoff.fingerprint is not null)
    and p_handoff.expires_at>clock_timestamp()
    and not exists(select 1 from private.capture_handoffs n where n.owner_id=p_handoff.owner_id
      and n.created_at>p_handoff.created_at)
    and exists(select 1 from auth.sessions s where s.id=p_handoff.session_id and s.user_id=p_handoff.owner_id
      and (s.not_after is null or s.not_after>clock_timestamp()))
    and exists(select 1 from private.current_account_access a where a.id=p_handoff.owner_id)
    and not exists(select 1 from private.account_closures x where x.user_id=p_handoff.owner_id)
    and exists(select 1 from private.evidence_cases c where c.id=p_handoff.case_id
      and c.subject_id=p_handoff.owner_id and c.kind='kyc' and c.status='open')
    and not exists(select 1 from private.accepted_identity_facts f where f.owner_id=p_handoff.owner_id)
    and not exists(select 1 from private.decisions d where d.case_id=p_handoff.case_id and d.status='proposed'
      and d.action='approve_override' and d.payload ? 'identity_submission_id');
$function$;
alter function internal.capture_handoff_usable(private.capture_handoffs,boolean) owner to postgres;
revoke all on function internal.capture_handoff_usable(private.capture_handoffs,boolean) from public;
