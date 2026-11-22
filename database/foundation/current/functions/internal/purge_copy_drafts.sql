-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.purge_copy_drafts(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare n integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  delete from private.posts p where p.id in (
    select x.id from private.post_copies c join private.posts x on x.id = c.post_id
    where x.status = 'draft' and x.edit_of is null
      and x.content_updated_at < statement_timestamp() - interval '14 days'
      and not exists(select 1 from private.legal_holds h where h.subject_id = x.owner_id and h.released_at is null)
    order by x.content_updated_at, x.id limit p_limit
    for update of x skip locked);
  get diagnostics n = row_count;
  return n;
end;
$function$;
alter function internal.purge_copy_drafts(integer) owner to postgres;
revoke all on function internal.purge_copy_drafts(integer) from public;
