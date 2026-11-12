-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.payment_line_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- A line is the price of one slot of a confirmed order: it never changes,
  -- except that it can be reversed (refunded or charged back) once.
  if (to_jsonb(new) - array['status','reversal_kind','reversal_reason','reversed_at','reversed_by'])
      is distinct from (to_jsonb(old) - array['status','reversal_kind','reversal_reason','reversed_at','reversed_by'])
    or old.status <> 'open' or new.status <> 'reversed' then
    raise exception 'payment lines are immutable; a line can only be reversed once' using errcode='23514';
  end if;
  return new;
end;
$function$;
alter function internal.payment_line_guard() owner to postgres;
revoke all on function internal.payment_line_guard() from public;
