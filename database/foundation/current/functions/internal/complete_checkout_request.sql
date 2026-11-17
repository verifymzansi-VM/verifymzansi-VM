-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_checkout_request(p_payment_id uuid, p_owner_id uuid, p_claim_token uuid, p_request_id text, p_checkout_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  if length(coalesce(p_request_id,'')) not between 1 and 100 or length(coalesce(p_checkout_url,'')) not between 10 and 4096
    or p_checkout_url !~ '^https://' then raise exception 'invalid checkout response' using errcode='22023'; end if;
  select * into pay from private.payments where id=p_payment_id and owner_id=p_owner_id for update;
  if not found or pay.status<>'pending' then raise exception 'pending checkout unavailable' using errcode='PT409'; end if;
  if pay.provider_request_id=p_request_id and pay.checkout_url=p_checkout_url then return true; end if;
  if pay.checkout_claim_token is distinct from p_claim_token or p_claim_token is null
    or pay.provider_request_id is not null then raise exception 'checkout claim superseded' using errcode='PT409'; end if;
  update private.payments set provider_request_id=p_request_id,checkout_url=p_checkout_url,
    checkout_claim_until=null where id=pay.id;
  return true;
end;
$function$;
alter function internal.complete_checkout_request(uuid,uuid,uuid,text,text) owner to postgres;
revoke all on function internal.complete_checkout_request(uuid,uuid,uuid,text,text) from public;
grant execute on function internal.complete_checkout_request(uuid,uuid,uuid,text,text) to service_role;
