-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare inv private.customer_invoices;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' or new.prepared_by is not null or new.approved_by is not null
        or new.invoice_id is not null or new.closed_at is not null then
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
  -- What the member asked for never changes; staff details are written once.
  if (new.id, new.account_id, new.member_request_id, new.plan_version_id, new.term_days, new.slots,
      new.unit_price_cents, new.total_cents, new.requested_at, new.consent_at, new.consent_version,
      new.consent_terms_version, new.kind, new.package_id, new.days_left)
    is distinct from (old.id, old.account_id, old.member_request_id, old.plan_version_id, old.term_days, old.slots,
      old.unit_price_cents, old.total_cents, old.requested_at, old.consent_at, old.consent_version,
      old.consent_terms_version, old.kind, old.package_id, old.days_left)
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
  if new.status = 'issued' then
    select * into inv from private.customer_invoices i where i.id = new.invoice_id;
    if not found or inv.account_id <> new.account_id or inv.plan_version_id <> new.plan_version_id
        or inv.slots <> new.slots or inv.unit_price_cents <> new.unit_price_cents
        or inv.total_cents <> new.total_cents or inv.request_id <> new.id or inv.issued_by <> new.prepared_by
        or inv.status <> 'issued' then
      raise exception 'an issued request names its own invoice of that order' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
alter function internal.package_invoice_request_guard() owner to postgres;
revoke all on function internal.package_invoice_request_guard() from public;
