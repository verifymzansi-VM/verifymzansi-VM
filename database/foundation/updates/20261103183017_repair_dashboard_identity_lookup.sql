-- current_verified_identity returns the current private fingerprint, not a fact
-- UUID. Resolve only this account's active fact; never return the fingerprint.
begin;
do $migration$
declare body text;
  previous text:='where f.id=internal.current_verified_identity(actor)';
  replacement text:='where f.owner_id=actor and f.revoked_at is null and f.identity_hmac=internal.current_verified_identity(actor)';
begin
  select prosrc into strict body from pg_proc where oid='internal.restored_owner_dashboard()'::regprocedure;
  if md5(body)='7927de67559fdf2be7434a378611066b' then
    body:=replace(body,previous,replacement);
    execute format('create or replace function internal.restored_owner_dashboard() returns jsonb language plpgsql stable security definer set search_path=pg_catalog as %L',body);
  elsif md5(replace(body,replacement,previous))<>'7927de67559fdf2be7434a378611066b' then
    raise exception 'Unknown owner dashboard function; review before repairing';
  end if;
end;
$migration$;
commit;
