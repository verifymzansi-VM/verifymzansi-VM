-- Reviewed rollback for updates/20261120040242_signup_mode_member_invitations.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It restores the previous sign-up hook (only administrator invitations admit
-- a sign-up, whatever the mode was, and an invitation again admits more than
-- one sign-up), the previous administrator invitation claim, retention job
-- and account erasure, and drops the sign-up trigger, the member invitation
-- commands, the mode and email domain functions, the member:invite
-- capability, the five tables and the two administrator invitation columns
-- (signed_up_by, signed_up_at). Member invitations and their history are
-- lost: invited members who have not signed up yet can no longer do so. It
-- refuses (55000) unless every part of the update is present, and once a mode
-- change has been recorded (the record of who opened or closed sign-up is
-- never dropped; undo such a state with a forward fix instead).
begin;
set local lock_timeout='5s';

do $$
begin
  if to_regclass('private.signup_settings') is null
    or to_regclass('private.signup_mode_events') is null
    or to_regclass('private.member_invitations') is null
    or to_regclass('private.member_invitation_events') is null
    or to_regclass('private.signup_blocked_domains') is null
    or not exists (select 1 from pg_attribute a
      where a.attrelid = 'private.owner_admin_invitations'::regclass
        and a.attname = 'signed_up_by' and not a.attisdropped)
    or to_regprocedure('internal.signup_settings_guard()') is null
    or to_regprocedure('internal.set_signup_mode(text,text,text)') is null
    or to_regprocedure('internal.get_signup_mode()') is null
    or to_regprocedure('api.get_signup_mode()') is null
    or to_regprocedure('internal.invite_member(text)') is null
    or to_regprocedure('api.invite_member(text)') is null
    or to_regprocedure('internal.revoke_member_invitation(text)') is null
    or to_regprocedure('api.revoke_member_invitation(text)') is null
    or to_regprocedure('internal.list_member_invitations()') is null
    or to_regprocedure('api.list_member_invitations()') is null
    or to_regprocedure('internal.purge_member_invitations(integer)') is null
    or to_regprocedure('internal.claim_signup_invitations()') is null
    or to_regprocedure('internal.signup_email_domain_refused(text)') is null
    or to_regprocedure('internal.check_email_domain(text)') is null
    or to_regprocedure('api.check_email_domain(text)') is null then
    raise exception 'rollback precondition: the sign-up mode update is not fully present'
      using errcode='55000';
  end if;
  if exists (select 1 from private.signup_mode_events) then
    raise exception 'rollback precondition: a sign-up mode change is recorded'
      using errcode='55000';
  end if;
end$$;

-- The previous hook (20261103154538_owner_signup_access.sql).
CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when jsonb_typeof(p_event #> '{user,email}')='string'
    and exists(select 1 from private.owner_admin_invitations i
      where i.email=lower(p_event #>> '{user,email}') and i.revoked_at is null)
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;

-- The previous retention job (20261119172135_post_views_and_likes.sql).
CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'engagement',internal.purge_post_engagement());
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

-- The previous administrator invitation claim.
CREATE OR REPLACE FUNCTION internal.claim_owner_admin_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare invitation private.owner_admin_invitations; account_email text;
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  select lower(u.email) into account_email from auth.users u
    join private.current_account_access a on a.id=u.id
    where u.id=new.user_id and u.email_confirmed_at is not null and u.is_anonymous is false;
  if not found then return new; end if;
  select * into invitation from private.owner_admin_invitations i
    where i.email=account_email and i.claimed_at is null and i.revoked_at is null for update;
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
alter function internal.claim_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_owner_admin_invitation() from public;

-- The previous account erasure (20261119172135_post_views_and_likes.sql).
CREATE OR REPLACE FUNCTION internal.erase_closed_account(p_user uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; reason text; earlier_retention text; counts jsonb := '{}'::jsonb; n integer;
begin
  if p_user is null or p_by is null or p_by not in ('staff', 'sweep') then
    raise exception 'account and erasing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if not found then raise exception 'account is not closed' using errcode = 'PT404', detail = 'account_not_closed'; end if;
  if er.erased_at is not null or er.erase_after > statement_timestamp() then
    return internal.account_erasure_state(p_user);
  end if;
  reason := internal.account_erasure_hold(p_user);
  if reason is not null then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = reason
      where user_id = p_user;
    return internal.account_erasure_state(p_user);
  end if;
  earlier_retention := coalesce(pg_catalog.current_setting('vm.retention', true), '');
  perform pg_catalog.set_config('vm.retention', 'on', true);
  perform pg_catalog.set_config('vm.erasure', p_user::text, true);

  select count(*) into n from private.enquiries q where q.owner_id = p_user or q.sender_account_id = p_user;
  counts := counts || jsonb_build_object('enquiries', n);
  -- Enquiries the account sent, with the other owner's notice and email.
  with gone as (
    delete from private.enquiries q where q.sender_account_id = p_user returning q.id
  ), notices as (
    delete from private.notifications x using gone where x.kind = 'enquiry_received' and x.subject_id = gone.id
  )
  delete from private.outbox_events o using gone where o.kind = 'enquiry_received' and o.subject_id = gone.id;
  -- Sponsored places first: deleting a place returns its grant.
  delete from private.organisation_sponsorships s where s.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sponsored_places', n);
  -- Posts, with their edit copies, contacts, media links, search documents,
  -- received enquiries and everything else that belongs to a post.
  delete from private.posts p where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('posts', n);
  delete from private.event_submissions e where e.owner_id = p_user;
  delete from private.enquiries q where q.owner_id = p_user;
  delete from private.notifications x where x.account_id = p_user;
  delete from private.outbox_events o where o.owner_id = p_user;
  delete from private.profiles x where x.account_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profile', n);
  -- Likes made signed in (20261119172135_post_views_and_likes.sql).
  delete from private.post_likes l where l.account_id = p_user;
  delete from private.frontend_form_drafts d where d.owner_id = p_user;
  delete from private.listing_price_drafts d where d.owner_id = p_user;
  delete from private.intro_trial_requests t where t.owner_id = p_user;
  delete from private.frontend_business_checks b where b.owner_id = p_user;
  delete from private.organisation_admins a where a.account_id = p_user;
  delete from private.organisation_applications a where a.applicant_id = p_user;
  delete from private.entitlement_members m where m.member_id = p_user or m.added_by = p_user
    or m.entitlement_id in (select e.id from private.entitlements e where e.owner_id = p_user);
  delete from private.frontend_post_commands c where c.owner_id = p_user;
  delete from private.frontend_post_action_receipts r where r.owner_id = p_user;
  delete from private.account_acquisitions a where a.account_id = p_user;
  delete from private.communication_choice_events c where c.account_id = p_user;
  delete from private.signup_terms_acceptances a where a.account_id = p_user;
  delete from private.posting_terms_acceptances a where a.owner_id = p_user;
  delete from private.verification_localities l where l.owner_id = p_user;
  -- Photos and videos nothing kept still uses: queued for deletion from
  -- storage now (the media cleanup job deletes the objects).
  update private.media_objects m set state = 'cleanup_required', cleanup_lease_until = null
    where m.owner_id = p_user and m.state in ('intent', 'ready', 'rejected') and not internal.media_object_in_use(m.id);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_queued', n);

  -- Paid time ends; payment records stay for their tax years, no longer
  -- linked to the account.
  update private.entitlements e set status = 'revoked', revoked_reason = 'account_erased'
    where e.owner_id = p_user and e.status <> 'revoked';
  update private.trial_identities t set owner_id = null, entitlement_id = null,
      detached_at = er.closed_at, retain_until = er.closed_at + interval '3 years'
    where t.owner_id = p_user;
  update private.post_activations a set owner_id = null where a.owner_id = p_user;
  update private.entitlements e set owner_id = null where e.owner_id = p_user;
  update private.payments p set owner_id = null where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payments_unlinked', n);
  update private.customer_invoices i set account_id = null where i.account_id = p_user;
  update private.invoice_transfers t set account_id = null where t.account_id = p_user;
  update private.payment_refund_requests r set account_id = null where r.account_id = p_user;
  update private.partner_commissions c set referred_account_id = null where c.referred_account_id = p_user;
  update private.individual_slot_limits l set account_id = null where l.account_id = p_user;
  update private.slot_packages k set owner_id = null where k.owner_id = p_user;
  -- Package invoice requests (20261119025106): an open one is withdrawn (it
  -- leaves the staff queue), then every one is kept unlinked like its invoice.
  update private.package_invoice_requests r set status = 'withdrawn', closed_at = statement_timestamp()
    where r.account_id = p_user and r.status in ('requested', 'awaiting_approval');
  update private.package_invoice_requests r set account_id = null where r.account_id = p_user;

  perform internal.remove_account_sign_in(p_user);
  perform pg_catalog.set_config('vm.erasure', '', true);
  perform pg_catalog.set_config('vm.retention', earlier_retention, true);
  update private.account_erasures set erased_at = statement_timestamp(), erased_by = p_by, erased_counts = counts,
      blocked_at = null, blocked_reason = null, auth_checked_at = statement_timestamp()
    where user_id = p_user;
  -- Deleting the Auth user never undoes the finished erasure: a failure is
  -- recorded and the daily check tries again.
  begin
    if internal.remove_erased_auth_user(p_user) then
      update private.account_erasures set auth_removed_at = statement_timestamp() where user_id = p_user;
    end if;
  exception when others then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
        blocked_detail = sqlstate
      where user_id = p_user;
  end;
  return internal.account_erasure_state(p_user);
end;
$function$;
alter function internal.erase_closed_account(uuid,text) owner to postgres;
revoke all on function internal.erase_closed_account(uuid,text) from public;

drop trigger claim_signup_invitations on auth.users;
drop function internal.claim_signup_invitations();
drop function api.get_signup_mode();
drop function internal.get_signup_mode();
drop function internal.set_signup_mode(text,text,text);
drop function api.invite_member(text);
drop function internal.invite_member(text);
drop function api.revoke_member_invitation(text);
drop function internal.revoke_member_invitation(text);
drop function api.list_member_invitations();
drop function internal.list_member_invitations();
drop function internal.purge_member_invitations(integer);
drop function api.check_email_domain(text);
drop function internal.check_email_domain(text);
drop function internal.signup_email_domain_refused(text);
delete from private.staff_capabilities where role = 'admin' and capability = 'member:invite';
-- The mode record is empty (checked above); append-only triggers go with
-- their tables.
drop table private.signup_mode_events;
drop table private.signup_settings;
drop function internal.signup_settings_guard();
drop table private.member_invitation_events;
drop table private.member_invitations;
drop table private.signup_blocked_domains;
alter table private.owner_admin_invitations
  drop column signed_up_by,
  drop column signed_up_at;

notify pgrst,'reload schema';
commit;
