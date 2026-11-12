-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_staff_slot_reversal(p_line_id uuid, p_kind text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; buyer uuid; line private.payment_lines; pay private.payments; ent private.entitlements;
  released integer := 0; v_post_ids uuid[] := '{}'::uuid[]; open_left integer; c record;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_line_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false) then
    raise exception 'valid slot reversal and reason required' using errcode='22023';
  end if;
  select p.owner_id into buyer from private.payment_lines l join private.payments p on p.id=l.payment_id where l.id=p_line_id;
  if buyer is null then raise exception 'slot payment line not found' using errcode='22023'; end if;
  if buyer=actor then raise exception 'a different staff member must record this reversal' using errcode='42501'; end if;
  perform internal.lock_evidence_subject(buyer);
  select p.* into pay from private.payments p join private.payment_lines l on l.payment_id=p.id where l.id=p_line_id
    for update of p;
  select * into line from private.payment_lines l where l.id=p_line_id for update;
  perform internal.staff_actor('payments:refund'); -- authority after any lock wait
  if line.status='reversed' then
    if line.reversed_by=actor and line.reversal_kind=p_kind and line.reversal_reason=btrim(p_reason) then
      return jsonb_build_object('status',line.reversal_kind,'line_id',line.id,'released_activations',0,
        'payment_status',pay.status,'repeated',true);
    end if;
    raise exception 'this slot was already reversed' using errcode='PT409';
  end if;
  if pay.status<>'complete' then
    raise exception 'only slots of a completed payment can be reversed' using errcode='22023';
  end if;
  begin
    select * into ent from private.entitlements e where e.payment_line_id=line.id for update nowait;
    perform p.id from private.posts p where p.id in
      (select a.post_id from private.post_activations a where a.entitlement_id=ent.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payment_lines set status='reversed', reversal_kind=p_kind, reversal_reason=btrim(p_reason),
    reversed_at=statement_timestamp(), reversed_by=actor where id=line.id;
  if ent.id is not null then
    update private.entitlements set status='revoked', revoked_reason='payment_'||p_kind
      where id=ent.id and status<>'revoked';
    with released_rows as (
      update private.post_activations a set released_at=statement_timestamp(), release_reason='payment_reversed'
      where a.entitlement_id=ent.id and a.released_at is null
      returning a.post_id
    )
    select coalesce(array_agg(post_id),'{}') into v_post_ids from released_rows;
    released := cardinality(v_post_ids);
    update private.posts p set status='expired', status_reason='Payment '||p_kind, revision=revision+1
      where p.id=any(v_post_ids) and (p.status in('live','pending_moderation')
        or (p.status='paused' and not exists(select 1 from private.frontend_content_holds h
          where h.post_id=p.id and h.released_at is null)));
    update private.post_search_documents set is_visible=false where post_id=any(v_post_ids);
  end if;
  -- Only this slot's commission.
  for c in select x.id,p.account_id from private.partner_commissions x join private.partners p on p.id=x.partner_id
      where x.payment_line_id=line.id and x.status<>'reversed' for update of x loop
    update private.partner_commissions set status='reversed',reversed_at=statement_timestamp(),
      reversal_reason='Slot payment '||p_kind where id=c.id;
    perform internal.notify_account(c.account_id,'partner_commission_reversed',c.id,null,null);
  end loop;
  select count(*) into open_left from private.payment_lines l where l.payment_id=pay.id and l.status='open';
  if open_left=0 then
    -- Every slot is reversed: so is the payment (its commission trigger finds nothing left).
    update private.payments set status=p_kind, fulfillment_status='reversed', status_changed_at=statement_timestamp()
      where id=pay.id;
  end if;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_line_reversed:' || line.id);
  perform internal.staff_actor('payments:refund');
  return jsonb_build_object('status',p_kind,'line_id',line.id,'released_activations',released,
    'payment_status',case when open_left=0 then p_kind else pay.status end,'repeated',false);
end;
$function$;
alter function internal.record_staff_slot_reversal(uuid,text,text) owner to postgres;
revoke all on function internal.record_staff_slot_reversal(uuid,text,text) from public;
grant execute on function internal.record_staff_slot_reversal(uuid,text,text) to authenticated;
