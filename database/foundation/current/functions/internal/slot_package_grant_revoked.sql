-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_grant_revoked()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- 20261120120000: the posts in the revoked grant that still fit in the
  -- package's other running grants stay in it (the reversal then ends only the
  -- others); this never stops the refund or chargeback.
  begin
    perform internal.slot_package_keep_posts(new.id);
  exception when others then
    raise warning 'slot package posts not kept after a revoked grant (%)', sqlstate;
  end;
  begin
    perform internal.slot_package_release_dates(new.owner_id);
  exception when others then
    raise warning 'slot package search documents left to the sweep (%)', sqlstate;
  end;
  begin
    perform internal.slot_package_release_paused(new.owner_id);
  exception when others then
    raise warning 'slot package paused posts left to the sweep (%)', sqlstate;
  end;
  return null;
end;
$function$;
alter function internal.slot_package_grant_revoked() owner to postgres;
revoke all on function internal.slot_package_grant_revoked() from public;
