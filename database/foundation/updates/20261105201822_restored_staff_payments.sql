-- The existing admin screen records a provider-side refund or chargeback.
-- It does not request payment movement or call a provider.
begin;
set local lock_timeout='5s';
insert into private.staff_capabilities(role,capability,requires_recent_mfa) values
  ('admin','payments:view',false),('admin','payments:refund',true);

create index payments_staff_recent_idx on private.payments(created_at desc,id desc);
create index payments_staff_status_recent_idx on private.payments(status,created_at desc,id desc);
create table private.frontend_payment_reversals(
  payment_id uuid primary key references private.payments(id) on delete cascade,
  actor_id uuid not null,
  kind text not null check(kind in('refunded','chargeback')),
  reason text not null check(internal.plain_text_valid(reason,5,500,true)),
  released_activations integer not null check(released_activations>=0),
  created_at timestamptz not null default statement_timestamp()
);
alter table private.frontend_payment_reversals enable row level security;
revoke all on private.frontend_payment_reversals from public,anon,authenticated,service_role;

-- Keep the existing audit event contract and access check. The reversal
-- receipt follows the financial retention of the corresponding payment.
alter view private.frontend_staff_audit_events rename to frontend_staff_nonpayment_audit_events;
create view private.frontend_staff_audit_events with(security_invoker=true) as
select * from private.frontend_staff_nonpayment_audit_events
union all
select 'payment:'||r.payment_id::text,r.created_at,r.actor_id,r.payment_id,
  'payment','payment:'||r.kind,r.reason from private.frontend_payment_reversals r;
revoke all on private.frontend_staff_audit_events from public,anon,authenticated,service_role;

create function internal.get_frontend_staff_payments(p_page integer,p_status text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;result jsonb;total bigint;
begin
  actor:=internal.staff_actor('payments:view');
  if p_page is null or p_page not between 1 and 100000 or (p_status is not null and p_status not in(
    'pending','processing','complete','failed','cancelled','expired','refunded','chargeback'))
    then raise exception 'valid payment filter required' using errcode='22023';end if;
  select count(*) into total from private.payments p where p_status is null or p.status=p_status;
  select jsonb_build_object('total',total,'page',p_page,'items',coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'user_id',p.owner_id,'status',p.status,'amount_cents',p.amount_cents,
    'created_at',p.created_at,'area',coalesce(p.snapshot->>'area',p.snapshot->>'target_area','all'),
    'description',coalesce(p.snapshot->>'label',initcap(p.snapshot->>'addon')||' add-on','Payment'))
    order by p.created_at desc,p.id desc),'[]'::jsonb))
    into result from (select * from private.payments x where p_status is null or x.status=p_status
      order by x.created_at desc,x.id desc limit 50 offset (p_page-1)*50)p;
  if internal.staff_actor('payments:view') is distinct from actor
    then raise exception 'staff actor changed' using errcode='42501';end if;
  return result;
end$$;
create function api.get_frontend_staff_payments(p_page integer,p_status text default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_frontend_staff_payments(p_page,p_status)
$$;
revoke all on function internal.get_frontend_staff_payments(integer,text),api.get_frontend_staff_payments(integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.get_frontend_staff_payments(integer,text),api.get_frontend_staff_payments(integer,text) to authenticated;

create function internal.record_frontend_staff_payment_reversal(p_id uuid,p_kind text,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;owner uuid;prior private.frontend_payment_reversals;result jsonb;
begin
  actor:=internal.staff_actor('payments:refund');
  if p_id is null or p_kind is null or p_kind not in('refunded','chargeback')
    or not coalesce(internal.plain_text_valid(p_reason,5,500,true),false)
    then raise exception 'valid reversal and reason required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('frontend-payment-reversal:'||p_id::text,0));
  perform internal.staff_actor('payments:refund');
  select * into prior from private.frontend_payment_reversals where payment_id=p_id;
  if found then
    if prior.actor_id=actor and prior.kind=p_kind and prior.reason=p_reason then
      return jsonb_build_object('status',prior.kind,'released_activations',prior.released_activations);
    end if;
    raise exception 'payment already reversed' using errcode='PT409';
  end if;
  select owner_id into owner from private.payments where id=p_id;
  if owner=actor then raise exception 'a different staff member must record this reversal' using errcode='42501';end if;
  result:=internal.reverse_payment(p_id,p_kind,p_reason);
  perform internal.staff_actor('payments:refund');
  insert into private.frontend_payment_reversals(payment_id,actor_id,kind,reason,released_activations)
    values(p_id,actor,p_kind,p_reason,(result->>'released_activations')::integer);
  return result;
end$$;
create function api.record_frontend_staff_payment_reversal(p_id uuid,p_kind text,p_reason text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.record_frontend_staff_payment_reversal(p_id,p_kind,p_reason)
$$;
revoke all on function internal.record_frontend_staff_payment_reversal(uuid,text,text),api.record_frontend_staff_payment_reversal(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function internal.record_frontend_staff_payment_reversal(uuid,text,text),api.record_frontend_staff_payment_reversal(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
