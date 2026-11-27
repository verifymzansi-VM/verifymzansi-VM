-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.business_contact_number(p_data jsonb, p_contacts jsonb, p_channel text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select case
   when p_channel is null or p_channel not in('call','whatsapp') then null
   when jsonb_typeof(p_data#>'{category_details,contact_methods}')='array'
     and not (p_data#>'{category_details,contact_methods}') ? p_channel then null
   when p_channel='whatsapp' and n !~ '^[+]27(6[0-9]|7[1-46-9]|8[1-4])' then null
   else n end
 from (select case
     when v ~ '^0[1-8][0-9]{8}$' then '+27'||substr(v,2)
     when v ~ '^27[1-8][0-9]{8}$' then '+'||v
     when v ~ '^[+]27[1-8][0-9]{8}$' then v end as n
   from (select regexp_replace(case when jsonb_typeof(p_contacts)='object'
       then p_contacts->>(case p_channel when 'call' then 'phone' else 'whatsapp' end) end,'[ ()-]','','g') as v) s) t;
$function$;
alter function internal.business_contact_number(jsonb,jsonb,text) owner to postgres;
revoke all on function internal.business_contact_number(jsonb,jsonb,text) from public;
