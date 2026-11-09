-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_inbox_counts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();
begin
  return jsonb_build_object(
    'unread_enquiries',(select count(*) from private.enquiries x where x.owner_id=actor and x.status='new'),
    'unread_notifications',(select count(*) from private.notifications n where n.account_id=actor and n.read_at is null));
end;
$function$;
alter function internal.get_my_inbox_counts() owner to postgres;
revoke all on function internal.get_my_inbox_counts() from public;
grant execute on function internal.get_my_inbox_counts() to authenticated;
