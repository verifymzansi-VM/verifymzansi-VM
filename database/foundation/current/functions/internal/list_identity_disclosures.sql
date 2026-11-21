-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.list_identity_disclosures()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare items jsonb;
begin
  perform internal.staff_actor('identity:disclose');
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'number',d.number,'opened_at',d.opened_at,
      'opened_by_name',internal.profile_public_name(p.display_name),
      'request_type',d.request_type,'reference',d.request_reference,'outcome',d.outcome,
      'viewed',exists(select 1 from private.identity_disclosure_events e where e.disclosure_id=d.id and e.kind='viewed'),
      'printed',exists(select 1 from private.identity_disclosure_events e where e.disclosure_id=d.id and e.kind='printed'))
    order by d.opened_at desc,d.id desc),'[]'::jsonb) into items
  from (select x.* from private.identity_disclosures x order by x.opened_at desc,x.id desc limit 50) d
  left join private.profiles p on p.account_id=d.opened_by;
  return jsonb_build_object('items',items);
end;
$function$;
alter function internal.list_identity_disclosures() owner to postgres;
revoke all on function internal.list_identity_disclosures() from public;
grant execute on function internal.list_identity_disclosures() to authenticated;
