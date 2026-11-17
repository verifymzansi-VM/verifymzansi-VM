-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.order_account_erasure(p_request uuid, p_revision integer, p_staff uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r private.privacy_requests; er private.account_erasures; subject uuid; linked uuid;
begin
  if p_request is null or p_staff is null or (p_revision is not null and p_revision not between 1 and 2147483646) then
    raise exception 'represented privacy request required' using errcode = '22023';
  end if;
  -- The account before the request, as closure and erasure lock them.
  select x.subject_user_id into subject from private.privacy_requests x where x.id = p_request;
  if subject is not null then perform internal.lock_evidence_subject(subject); end if;
  select * into r from private.privacy_requests x where x.id = p_request for update;
  if not found or (p_revision is not null and r.revision <> p_revision) or r.subject_user_id is distinct from subject then
    raise exception 'privacy request changed' using errcode = 'PT409';
  end if;
  if r.type <> 'deletion' or r.status <> 'in_progress' or not r.identity_verified then
    raise exception 'verified deletion request in progress required' using errcode = 'PT409',
      detail = 'deletion_request_required';
  end if;
  if not exists (select 1 from private.staff_roles s
      join private.staff_capabilities c on c.role = s.role and c.capability = 'dsar:manage'
      join private.current_account_access a on a.id = s.user_id
      where s.user_id = p_staff and s.revoked_at is null) then
    raise exception 'privacy capability required' using errcode = '42501';
  end if;
  if p_staff = r.subject_user_id or exists (select 1 from auth.users u where u.id = p_staff
      and lower(u.email) = lower(r.requester_email)) then
    raise exception 'another staff member must process your request' using errcode = '42501';
  end if;
  select l.user_id into linked from private.account_erasure_requests l where l.request_id = r.id;
  if r.subject_user_id is null then
    if linked is null then
      raise exception 'this request names no account to erase' using errcode = 'PT409', detail = 'no_account';
    end if;
    return jsonb_build_object('request_id', r.id) || internal.account_erasure_state(linked);
  end if;
  if r.verified_by is not distinct from p_staff then
    raise exception 'another staff member checked the identity; a second one orders the erasure'
      using errcode = '42501', detail = 'second_person_required';
  end if;
  if exists (select 1 from private.staff_roles s where s.user_id = r.subject_user_id and s.revoked_at is null) then
    raise exception 'end the staff roles of this account first' using errcode = 'PT409', detail = 'staff_account';
  end if;
  er := internal.close_account_now(r.subject_user_id, 'staff', p_staff);
  if linked is null then
    insert into private.account_erasure_requests (request_id, user_id, linked_how, linked_by)
      values (r.id, r.subject_user_id, 'staff_ordered', p_staff);
    -- The request is answered within 7 days after the grace period ends (or
    -- after it arrived, for an account closed long before).
    update private.privacy_requests set due_by = greatest(er.erase_after, r.received_at) + interval '7 days',
        processed_by = p_staff, revision = revision + 1
      where id = r.id;
    insert into private.privacy_request_events (request_id, actor_id, action, represented_revision)
      values (r.id, p_staff, 'erasure_ordered', r.revision);
    -- A new verified request supersedes an earlier rejection (a legal hold
    -- placed then still applies until staff release it).
    update private.account_erasures set rejected_at = null where user_id = r.subject_user_id;
  end if;
  if er.erased_at is null and er.erase_after <= statement_timestamp() then
    perform internal.erase_closed_account(r.subject_user_id, 'staff');
  end if;
  return jsonb_build_object('request_id', r.id) || internal.account_erasure_state(er.user_id);
end;
$function$;
alter function internal.order_account_erasure(uuid,integer,uuid) owner to postgres;
revoke all on function internal.order_account_erasure(uuid,integer,uuid) from public;
