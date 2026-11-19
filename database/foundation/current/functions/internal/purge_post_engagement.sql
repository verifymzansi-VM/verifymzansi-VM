-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  salts integer; marks integer := 0; batch integer; rounds integer := 0;
begin
  delete from private.post_view_salts s where s.day < today - 1;
  get diagnostics salts = row_count;
  loop
    delete from private.post_view_marks m where m.mark in (select x.mark from private.post_view_marks x
      where x.seen_at < statement_timestamp() - interval '24 hours' limit 10000);
    get diagnostics batch = row_count;
    marks := marks + batch;
    rounds := rounds + 1;
    exit when batch < 10000 or rounds >= 20;
  end loop;
  return jsonb_build_object('salts', salts, 'marks', marks);
end;
$function$;
alter function internal.purge_post_engagement() owner to postgres;
revoke all on function internal.purge_post_engagement() from public;
