-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices; got boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' or new.prepared_by is not null or new.approved_by is not null
        or new.invoice_id is not null or new.closed_at is not null or new.invoiced_days is not null then
      raise exception 'a package invoice request starts as requested' using errcode='23514';
    end if;
    return new;
  end if;
  -- An erasure unlinks the erased account from this kept record
  -- (internal.erase_closed_account); nothing else may change with it.
  if coalesce(pg_catalog.current_setting('vm.erasure', true), '') <> ''
      and internal.erasure_unlinks(to_jsonb(old), to_jsonb(new), array['account_id']) then
    return new;
  end if;
  -- The retention job's removal of a package record unlinks it from an
  -- added-slots request (20261120045404); nothing else may change with it.
  if pg_catalog.current_setting('vm.retention', true) = 'on' and old.package_id is not null
      and new.package_id is null
      and (to_jsonb(new) - 'package_id') = (to_jsonb(old) - 'package_id') then
    return new;
  end if;
  -- What the member asked for never changes; staff details are written once.
  if (new.id, new.account_id, new.member_request_id, new.plan_version_id, new.term_days, new.slots,
      new.unit_price_cents, new.total_cents, new.requested_at, new.consent_at, new.consent_version,
      new.consent_terms_version, new.kind, new.package_id, new.days_left)
    is distinct from (old.id, old.account_id, old.member_request_id, old.plan_version_id, old.term_days, old.slots,
      old.unit_price_cents, old.total_cents, old.requested_at, old.consent_at, old.consent_version,
      old.consent_terms_version, old.kind, old.package_id, old.days_left)
    or old.invoiced_days is not null and new.invoiced_days is distinct from old.invoiced_days
    or (old.prepared_by is not null and (new.prepared_by, new.prepared_at, new.due_days, new.staff_reason)
      is distinct from (old.prepared_by, old.prepared_at, old.due_days, old.staff_reason)) then
    raise exception 'a package invoice request keeps what was asked and prepared' using errcode='23514';
  end if;
  -- requested -> awaiting_approval, issued, declined or withdrawn;
  -- awaiting_approval -> issued, declined or withdrawn (the account closed);
  -- nothing after that.
  if not ((old.status = 'requested' and new.status in ('awaiting_approval', 'issued', 'declined', 'withdrawn'))
      or (old.status = 'awaiting_approval' and new.status in ('issued', 'declined', 'withdrawn'))) then
    raise exception 'a package invoice request moves on once, from requested or awaiting approval'
      using errcode='23514';
  end if;
  if new.status <> 'issued' and new.invoiced_days is not null then
    raise exception 'only an issued request records the days it was invoiced for' using errcode='23514';
  end if;
  if new.status = 'issued' then
    select * into inv from private.customer_invoices i where i.id = new.invoice_id;
    got := found;
    -- 20261120045404: an added-slots invoice is issued for the whole days left
    -- at that moment when they are fewer than the days it was priced for
    -- (internal.issue_package_customer_invoice), at that lower price; this
    -- records those days and checks the invoice's price against them.
    if new.kind = 'add' then
      new.invoiced_days := least(new.days_left,
        (select q.days_left from internal.slot_package_add_quote(new.account_id) q where q.package_id = new.package_id));
    end if;
    if not got or inv.account_id <> new.account_id or inv.plan_version_id <> new.plan_version_id
        or inv.slots <> new.slots
        or inv.unit_price_cents <> (case when new.kind = 'add' and new.invoiced_days < new.days_left
          then (select round(v.price_cents::numeric * new.invoiced_days / v.duration_days)::bigint
            from private.plan_versions v where v.id = new.plan_version_id)
          else new.unit_price_cents end)
        or inv.total_cents <> inv.unit_price_cents * new.slots
        or (new.kind = 'add') <> (new.invoiced_days is not null)
        or inv.request_id <> new.id or inv.issued_by <> new.prepared_by
        or inv.status <> 'issued' then
      raise exception 'an issued request names its own invoice of that order' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
alter function internal.package_invoice_request_guard() owner to postgres;
revoke all on function internal.package_invoice_request_guard() from public;
