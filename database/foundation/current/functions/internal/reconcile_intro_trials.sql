-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reconcile_intro_trials(p_limit integer DEFAULT 20)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare target record; granted integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid limit' using errcode='22023'; end if;
  for target in select u.id from private.current_account_access u
    join private.accepted_identity_facts f on f.owner_id=u.id and f.revoked_at is null
    where internal.current_verified_identity(u.id) is not null
      and exists(select 1 from private.verification_phone_proofs p where p.owner_id=u.id and p.revoked_at is null)
      and exists(select 1 from private.verification_localities l where l.owner_id=u.id)
      and not exists(select 1 from private.trial_identities t where t.identity_hmac=f.identity_hmac)
    order by u.id limit p_limit
  loop
    begin
      perform internal.grant_verified_intro_trial(target.id,7);
      granted:=granted+1;
    exception when sqlstate '42501' or sqlstate 'PT409' then null;
    end;
  end loop;
  return granted;
end;
$function$;
alter function internal.reconcile_intro_trials(integer) owner to postgres;
revoke all on function internal.reconcile_intro_trials(integer) from public;
grant execute on function internal.reconcile_intro_trials(integer) to service_role;
