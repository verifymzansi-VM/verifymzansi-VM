-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.extend_free_credit(p_credit_id uuid, p_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.staff_actor('free_credit:give');
  v_gift private.entitlements;
  v_ends timestamptz;
begin
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'free credits: choose 1 to 30 days' using errcode='22023', detail='free_credit_days_invalid';
  end if;
  if not coalesce(internal.plain_text_valid(p_reason, 5, 200, false), false) then
    raise exception 'free credits: a reason of 5 to 200 characters is required' using errcode='22023',
      detail='free_credit_reason_required';
  end if;
  -- One extension at a time per gift: the second waits and adds to the end
  -- the first set.
  select e.* into v_gift from private.entitlements e where e.id=p_credit_id and e.source='free_credit' for update;
  if v_gift.id is null then
    raise exception 'free credits: unknown gift' using errcode='22023', detail='free_credit_not_found';
  end if;
  actor := internal.staff_actor('free_credit:give'); -- authority after the row wait
  if v_gift.status<>'active' or v_gift.owner_id is null then
    raise exception 'free credits: this gift can no longer be extended' using errcode='PT409', detail='free_credit_closed';
  end if;
  if not exists(select 1 from private.current_account_access a where a.id=v_gift.owner_id) then
    raise exception 'free credits: no active member account has this email' using errcode='PT409',
      detail='free_credit_member_not_found';
  end if;
  perform internal.assert_staff_payment_actor(actor, v_gift.owner_id);
  if internal.current_verified_identity(v_gift.owner_id) is null then
    raise exception 'free credits: the member''s ID review must be accepted first' using errcode='PT409',
      detail='free_credit_identity_required';
  end if;
  -- From the current end while the gift runs, otherwise from now.
  v_ends := greatest(v_gift.ends_at, statement_timestamp())+make_interval(days=>p_days);
  update private.entitlements set ends_at=v_ends where id=v_gift.id;
  perform internal.refresh_slot_chain_documents(v_gift.id);
  insert into private.free_credit_events(entitlement_id, action, actor_id, posts, days, ends_at, reason)
    values(v_gift.id, 'extended', actor, v_gift.slot_capacity, p_days, v_ends, p_reason);
  return jsonb_build_object('id', v_gift.id, 'posts', v_gift.slot_capacity, 'ends_at', v_ends);
end;
$function$;
alter function internal.extend_free_credit(uuid,integer,text) owner to postgres;
revoke all on function internal.extend_free_credit(uuid,integer,text) from public;
grant execute on function internal.extend_free_credit(uuid,integer,text) to authenticated;
