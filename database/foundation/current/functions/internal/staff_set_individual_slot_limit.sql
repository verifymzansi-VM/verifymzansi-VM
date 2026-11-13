-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.staff_set_individual_slot_limit(p_account_id uuid, p_slot_limit integer, p_ends_at timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; fingerprint text; raised private.individual_slot_limits;
begin
  actor:=internal.staff_actor('slots:raise_limit');
  if p_account_id is null or p_slot_limit is null or p_slot_limit not between 4 and 25
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false)
    or (p_slot_limit>4 and (p_ends_at is null or p_ends_at<=statement_timestamp()+interval '1 day'
      or p_ends_at>statement_timestamp()+interval '366 days'))
    or (p_slot_limit=4 and p_ends_at is not null) then
    raise exception 'valid slot limit (4 to 25), end date and reason required' using errcode='22023';
  end if;
  perform internal.assert_staff_acts_for_other(actor, p_account_id, 'limit');
  perform internal.lock_evidence_subject(p_account_id);
  fingerprint:=internal.current_verified_identity(p_account_id);
  if fingerprint is null and p_slot_limit>4 then
    raise exception 'the person''s ID review must be accepted first' using errcode='PT409';
  end if;
  -- Ending a raise works after the review lapsed: the person's latest fingerprint.
  fingerprint:=coalesce(fingerprint, internal.individual_slot_identity(p_account_id));
  if fingerprint is null then
    raise exception 'this account has no ID review' using errcode='PT409';
  end if;
  if p_slot_limit>4 and not internal.individual_slot_business_checked(p_account_id) then
    raise exception 'more than 4 slots need a checked business' using errcode='PT409';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('individual-slots:'||fingerprint, 707));
  perform internal.staff_actor('slots:raise_limit'); -- authority after any lock wait
  perform internal.assert_staff_acts_for_other(actor, p_account_id, 'limit');
  update private.individual_slot_limits set revoked_at=clock_timestamp(), revoked_by=actor, revoke_reason=btrim(p_reason)
    where identity_hmac=fingerprint and revoked_at is null;
  if p_slot_limit>4 then
    insert into private.individual_slot_limits(identity_hmac, account_id, slot_limit, ends_at, reason, granted_by)
      values(fingerprint, p_account_id, p_slot_limit, p_ends_at, btrim(p_reason), actor)
      returning * into raised;
  end if;
  return jsonb_build_object('slot_limit', internal.individual_slot_limit(fingerprint), 'ends_at', raised.ends_at,
    'held', (internal.individual_slots_counted(fingerprint, p_account_id, null)->>'held')::integer);
end;
$function$;
alter function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) owner to postgres;
revoke all on function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) from public;
grant execute on function internal.staff_set_individual_slot_limit(uuid,integer,timestamp with time zone,text) to authenticated;
