-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_refund_request_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- The request, its reference, amount and account never change; a request
  -- waiting for approval is applied or declined once, and the account is
  -- always the one that paid.
  if tg_op = 'INSERT' then
    if new.account_id is distinct from (select p.owner_id from private.payments p where p.id = new.payment_id)
      or new.amount_cents is distinct from coalesce(
        (select l.amount_cents from private.payment_lines l where l.id = new.payment_line_id),
        case when new.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = new.payment_id) end) then
      raise exception 'a refund is the paid amount, for the account that paid' using errcode='23514';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
      is distinct from (to_jsonb(old) - array['status','approved_by','applied_at','released_activations','declined_by','declined_at','decline_reason'])
    or old.status <> 'awaiting_approval' or new.status not in ('applied', 'declined') then
    raise exception 'refund records are immutable; a waiting refund is applied or declined once' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_refund_request_guard() owner to postgres;
revoke all on function internal.payment_refund_request_guard() from public;
