-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.remove_erased_auth_user(p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if not exists (select 1 from private.account_erasures e where e.user_id = p_user and e.erased_at is not null) then
    raise exception 'account not erased' using errcode = 'PT409', detail = 'erasure_pending';
  end if;
  begin
    delete from private.media_objects m where m.owner_id = p_user and m.state = 'deleted';
    delete from private.account_closures c where c.user_id = p_user;
    delete from auth.users u where u.id = p_user;
    return true;
  exception when foreign_key_violation or restrict_violation or check_violation then
    -- A kept record still names the account (its foreign key, or the record
    -- guard of a table that keeps its rows).
    return false;
  end;
end;
$function$;
alter function internal.remove_erased_auth_user(uuid) owner to postgres;
revoke all on function internal.remove_erased_auth_user(uuid) from public;
