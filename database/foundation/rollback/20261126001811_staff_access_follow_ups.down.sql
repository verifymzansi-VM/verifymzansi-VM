-- Reviewed rollback for updates/20261126001811_staff_access_follow_ups.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. It removes the trigger on
-- private.owner_admin_invitations, its function and the claim helper, and puts
-- back the earlier bodies of internal.claim_owner_admin_invitation() and
-- internal.close_account_evidence(uuid) byte for byte: only a new or newly
-- verified authenticator app claims an invitation again, without the
-- per-person lock, and the service command closes a staff account again.
-- Admin roles claimed meanwhile stay as they are.
-- It refuses (55000) unless both functions have the update's bodies.
begin;
set local lock_timeout='5s';

do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.claim_owner_admin_invitation()');
  if body is null or body not in('aad6e9487ca76eba953086e5054fad11') then
    raise exception 'rollback precondition: the staff access follow-ups update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_proc p
    where p.oid=to_regprocedure('internal.close_account_evidence(uuid)');
  if body is null or body not in('1b447b3fe8805138814c3cdb0ceb6daa') then
    raise exception 'rollback precondition: the staff access follow-ups update is not applied as reviewed (%)',coalesce(body,'absent')
      using errcode='55000';
  end if;
end$$;

drop trigger if exists claim_new_owner_admin_invitation on private.owner_admin_invitations;
drop function if exists internal.claim_new_owner_admin_invitation();

create or replace function internal.claim_owner_admin_invitation()
returns trigger language plpgsql security definer set search_path to 'pg_catalog' as $function$
declare invitation private.owner_admin_invitations; account_email text;
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  select lower(u.email) into account_email from auth.users u
    join private.current_account_access a on a.id=u.id
    where u.id=new.user_id and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found then return new; end if;
  -- An invitation already signed up by an account is claimed only by that
  -- account, never by a later one after it is erased
  -- (20261120040242_signup_mode_member_invitations.sql).
  select * into invitation from private.owner_admin_invitations i
    where i.email=account_email and i.claimed_at is null and i.revoked_at is null
      and (i.signed_up_at is null or i.signed_up_by=new.user_id) for update;
  if not found then return new; end if;
  -- Serialise with the first-administrator bootstrap and ordinary role grants.
  lock table private.staff_roles in share row exclusive mode;
  if exists(select 1 from private.staff_roles r where r.user_id=new.user_id) then
    return new; -- A prior/revoked assignment is never reactivated by an invitation.
  end if;
  insert into private.staff_roles(user_id,role) values(new.user_id,'admin');
  update private.owner_admin_invitations set claimed_by=new.user_id,claimed_at=now()
    where email=invitation.email;
  return new;
end;
$function$;
revoke all on function internal.claim_owner_admin_invitation() from public,anon,authenticated,service_role;

drop function if exists internal.claim_owner_admin_invitation_for(uuid,boolean);

create or replace function internal.close_account_evidence(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $function$
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
  -- 20261119025106: an open package invoice request is withdrawn, so it leaves
  -- the staff queue and no invoice is issued to a closed account.
  update private.package_invoice_requests set status = 'withdrawn', closed_at = statement_timestamp()
    where account_id = p_user_id and status in ('requested', 'awaiting_approval');
  update private.evidence_cases set status = 'closed', claimed_by = null, claim_expires_at = null,claim_nonce=null,
    version=least(version::bigint+1,2147483647)::integer
  where subject_id = p_user_id and status = 'open' and kind in('kyc','business');
  return jsonb_build_object('closed_at', closure.closed_at,
    'evidence_delete_after', closure.evidence_delete_after, 'scheduled', scheduled,
    'trial_fingerprints_detached', trial_fingerprints);
end;
$function$;
revoke all on function internal.close_account_evidence(uuid) from public,anon,authenticated;
grant execute on function internal.close_account_evidence(uuid) to service_role;
commit;
