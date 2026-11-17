-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_frontend_support(p_name text, p_email text, p_category text, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare sender text:=lower(btrim(p_email));sender_name text;body text;x private.support_tickets;now_at timestamptz;
begin
  if sender is null or length(sender)>254 or sender !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_category is null or p_category not in('fraud_report','verification_appeal','privacy_popia','payment_refund','security_vulnerability','business_claim','organisation_proposal','general_support')
    then raise exception 'check support recipient and category' using errcode='22023';end if;
  sender_name:=internal.privacy_text(p_name,2,100);body:=internal.privacy_text(p_message,10,2000);
  perform pg_advisory_xact_lock(hashtextextended(sender,6502));now_at:=clock_timestamp();
  select * into x from private.support_tickets t where t.email=sender and t.name=sender_name and t.category=p_category and t.message=body
    and t.created_at>now_at-interval '10 minutes' order by t.created_at desc,t.id desc limit 1;
  if found then
    return jsonb_build_object('id',x.id,'reused',true,'accepted',(select m.accepted from private.support_ticket_mail m
      where m.ticket_id=x.id and m.template='support_acknowledgement'));
  end if;
  insert into private.support_tickets(name,email,category,message) values(sender_name,sender,p_category,body) returning * into x;
  return jsonb_build_object('id',x.id,'reused',false,'accepted',null);
end$function$;
alter function internal.submit_frontend_support(text,text,text,text) owner to postgres;
revoke all on function internal.submit_frontend_support(text,text,text,text) from public;
grant execute on function internal.submit_frontend_support(text,text,text,text) to service_role;
