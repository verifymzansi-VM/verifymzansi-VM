-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.retention_tax_year_due(p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_at is not null and pg_catalog.make_timestamptz(
      extract(year from p_at at time zone 'Africa/Johannesburg')::integer
        + case when extract(month from p_at at time zone 'Africa/Johannesburg')>=3 then 1 else 0 end,
      3,1,0,0,0,'Africa/Johannesburg') + interval '5 years' <= statement_timestamp();
$function$;
alter function internal.retention_tax_year_due(timestamp with time zone) owner to postgres;
revoke all on function internal.retention_tax_year_due(timestamp with time zone) from public;
