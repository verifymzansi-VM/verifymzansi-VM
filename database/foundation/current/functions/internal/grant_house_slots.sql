-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.grant_house_slots(p_recipient_email text, p_slots integer, p_days integer, p_reason text, p_approved_by_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_recipient uuid; v_approver uuid; v_identity text; v_approver_identity text; v_ends timestamptz;
  v_held uuid[]; v_slot private.entitlements; v_self boolean;
  v_id uuid; v_added integer:=0; v_extended integer:=0;
begin
  -- The count of slots already held is read after the staff role lock; only
  -- read committed sees a grant that committed while this one waited.
  if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
    raise exception 'house slots: run this command in a read committed transaction' using errcode='55000',
      detail='house_slots_isolation';
  end if;
  if p_slots is null or p_slots<1 or p_slots>25 then
    raise exception 'house slots: choose 1 to 25 slots' using errcode='22023', detail='house_slots_count_invalid';
  end if;
  if p_days is null or p_days<7 or p_days>180 then
    raise exception 'house slots: choose a term of 7 to 180 days' using errcode='22023', detail='house_slots_term_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 500, true), false) then
    raise exception 'house slots: a written reason of 5 to 500 characters is required' using errcode='22023',
      detail='house_slots_reason_required';
  end if;
  select u.id into v_recipient from auth.users u
    where lower(u.email)=lower(btrim(p_recipient_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  select u.id into v_approver from auth.users u
    where lower(u.email)=lower(btrim(p_approved_by_email)) and u.email_confirmed_at is not null and u.is_anonymous is false;
  if v_recipient is null then
    raise exception 'house slots: a confirmed recipient account is required' using errcode='42501',
      detail='house_slots_recipient_invalid';
  end if;
  if v_approver is null then
    raise exception 'house slots: a confirmed approving administrator account is required' using errcode='42501',
      detail='house_slots_approver_invalid';
  end if;
  v_self:=v_approver=v_recipient;
  -- Both current staff roles, in one order: a role removal at the same moment
  -- waits for this grant (and then ends what it added), or this grant sees it.
  perform r.id from private.staff_roles r where r.user_id in(v_recipient, v_approver) and r.revoked_at is null
    order by r.id for update;
  if not exists(select 1 from private.staff_roles r where r.user_id=v_recipient and r.role='admin' and r.revoked_at is null) then
    raise exception 'house slots: the recipient must hold an active admin role' using errcode='42501',
      detail='house_slots_not_admin';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id=v_recipient) then
    raise exception 'house slots: the recipient account is not active' using errcode='42501',
      detail='house_slots_recipient_inactive';
  end if;
  v_identity:=internal.current_verified_identity(v_recipient);
  if v_identity is null then
    raise exception 'house slots: the recipient''s ID review must be accepted' using errcode='42501',
      detail='house_slots_identity_required';
  end if;
  if not exists(select 1 from auth.mfa_factors f where f.user_id=v_recipient and f.factor_type='totp' and f.status='verified') then
    raise exception 'house slots: the recipient needs a verified authenticator app' using errcode='42501',
      detail='house_slots_mfa_required';
  end if;
  if v_self then
    -- Single-administrator mode: while the recipient is the only ID-verified
    -- staff member, they approve a grant to their own admin account. Each
    -- event is marked self_granted.
    if not internal.single_administrator(v_recipient) then
      raise exception 'house slots: the approver must be a different administrator account' using errcode='42501',
        detail='house_slots_self_approval';
    end if;
  else
    if not exists(select 1 from private.staff_roles r where r.user_id=v_approver and r.role='admin' and r.revoked_at is null)
      or not exists(select 1 from private.current_account_access a where a.id=v_approver)
      or not exists(select 1 from auth.mfa_factors f where f.user_id=v_approver and f.factor_type='totp' and f.status='verified') then
      raise exception 'house slots: the approver must be an active administrator with a verified authenticator app'
        using errcode='42501', detail='house_slots_approver_invalid';
    end if;
    -- Approval needs a second ID-verified person, not only a second account.
    v_approver_identity:=internal.current_verified_identity(v_approver);
    if v_approver_identity is null then
      raise exception 'house slots: the approver''s ID review must be accepted' using errcode='42501',
        detail='house_slots_approver_identity_required';
    end if;
    if v_approver_identity=v_identity then
      raise exception 'house slots: the approver must be a different person' using errcode='42501',
        detail='house_slots_same_person';
    end if;
  end if;
  v_ends:=statement_timestamp()+make_interval(days=>p_days);
  -- The account's current house slots, locked in the order
  -- internal.activate_post locks slots in (end date, then id).
  select coalesce(array_agg(x.id order by x.ends_at, x.id), '{}') into v_held from (select e.id, e.ends_at
      from private.entitlements e
      where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.starts_at<=statement_timestamp() and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)
      order by e.ends_at, e.id for update) x;
  if cardinality(v_held)>p_slots then
    raise exception 'house slots: the account already holds % house slots; this command only adds or extends them',
      cardinality(v_held) using errcode='22023', detail='house_slots_count_invalid';
  end if;
  for v_slot in select e.* from private.entitlements e where e.id=any(v_held) and e.ends_at<v_ends order by e.ends_at, e.id loop
    update private.entitlements set ends_at=v_ends where id=v_slot.id;
    perform internal.refresh_slot_chain_documents(v_slot.id);
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason, self_granted)
      values(v_slot.id, 'extended', v_ends, v_approver, p_reason, v_self);
    v_extended:=v_extended+1;
  end loop;
  for i in 1..(p_slots-cardinality(v_held)) loop
    insert into private.entitlements(owner_id, source, area, granted_by, slot_capacity, activations_per_period,
        activation_period_days, max_photos, max_videos, starts_at, ends_at, addon_capabilities)
      values(v_recipient, 'staff_grant', null, v_approver, 1, 4, 30, 10, 1, statement_timestamp(), v_ends, '{}')
      returning id into v_id;
    insert into private.house_slot_events(entitlement_id, action, ends_at, approved_by, reason, self_granted)
      values(v_id, 'granted', v_ends, v_approver, p_reason, v_self);
    v_added:=v_added+1;
  end loop;
  return jsonb_build_object('account_id', v_recipient, 'approved_by', v_approver, 'house_slots', p_slots,
    'added', v_added, 'extended', v_extended, 'self_granted', v_self,
    'slots', (select jsonb_agg(jsonb_build_object('id', e.id, 'ends_at', e.ends_at) order by e.ends_at, e.id)
      from private.entitlements e where e.owner_id=v_recipient and e.source='staff_grant' and e.status='active'
        and e.ends_at>statement_timestamp()
        and exists(select 1 from private.house_slot_events h where h.entitlement_id=e.id)));
end;
$function$;
alter function internal.grant_house_slots(text,integer,integer,text,text) owner to postgres;
revoke all on function internal.grant_house_slots(text,integer,integer,text,text) from public;
