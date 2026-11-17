-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_listing_price_draft(p_expected_revision integer, p_category_key text, p_terms jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); terms jsonb:=internal.validated_listing_terms(p_category_key,p_terms); result jsonb;
begin
  if p_expected_revision is null or p_expected_revision not between 0 and 2147483646 then
    raise exception 'invalid draft revision' using errcode='22023';
  end if;
  if p_expected_revision=0 then
    insert into private.listing_price_drafts as d(owner_id,category_key,price_mode,price_cents,price_negotiable,revision,expires_at)
      values(actor,p_category_key,terms->>'price_mode',(terms->>'price_cents')::bigint,(terms->>'price_negotiable')::boolean,1,statement_timestamp()+interval '14 days')
      on conflict(owner_id) do update set category_key=excluded.category_key,price_mode=excluded.price_mode,
        price_cents=excluded.price_cents,price_negotiable=excluded.price_negotiable,revision=d.revision+1,expires_at=excluded.expires_at
        where d.expires_at<=statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  else
    update private.listing_price_drafts d set category_key=p_category_key,price_mode=terms->>'price_mode',price_cents=(terms->>'price_cents')::bigint,
      price_negotiable=(terms->>'price_negotiable')::boolean,revision=d.revision+1,expires_at=statement_timestamp()+interval '14 days'
      where d.owner_id=actor and d.revision=p_expected_revision and d.expires_at>statement_timestamp()
      returning jsonb_build_object('category_key',d.category_key,'price_mode',d.price_mode,'price_cents',d.price_cents,'price_negotiable',d.price_negotiable,'revision',d.revision,'expires_at',d.expires_at) into result;
  end if;
  if result is null then raise exception 'draft changed or expired' using errcode='PT409'; end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return result;
end;
$function$;
alter function internal.save_listing_price_draft(integer,text,jsonb) owner to postgres;
revoke all on function internal.save_listing_price_draft(integer,text,jsonb) from public;
grant execute on function internal.save_listing_price_draft(integer,text,jsonb) to authenticated;
