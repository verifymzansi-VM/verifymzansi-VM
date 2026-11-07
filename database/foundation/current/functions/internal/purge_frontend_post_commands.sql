-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_frontend_post_commands(p_limit integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare candidate record; held private.frontend_post_commands;
begin
  for candidate in select owner_id,request_id from private.frontend_post_commands
    where (result is null and payload is distinct from '{"expired":true}'::jsonb and expires_at<=statement_timestamp())
      or created_at<statement_timestamp()-interval '90 days' order by created_at limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.owner_id::text,2408)) then continue; end if;
    select * into held from private.frontend_post_commands where owner_id=candidate.owner_id and request_id=candidate.request_id for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=candidate.owner_id and h.released_at is null) then continue; end if;
    if held.created_at<statement_timestamp()-interval '90 days' then
      delete from private.frontend_post_commands where owner_id=candidate.owner_id and request_id=candidate.request_id;
    elsif held.result is null and held.expires_at<=statement_timestamp() then
      update private.frontend_post_commands set payload='{"expired":true}'::jsonb where owner_id=candidate.owner_id and request_id=candidate.request_id;
    end if;
  end loop;
end$function$;
alter function internal.purge_frontend_post_commands(integer) owner to postgres;
revoke all on function internal.purge_frontend_post_commands(integer) from public;
