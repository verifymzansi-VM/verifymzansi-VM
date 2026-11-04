-- Retention retires encrypted files without revoking the accepted review.
-- Use the same reviewed-evidence predicate as the canonical identity fact;
-- current uploads still require clean, unexpired artifacts before acceptance.
begin;
do $$declare before text;after text;begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid='internal.get_my_frontend_identity_state()'::regprocedure)<>'f76b7cab7f04591937a732ff6824101d' then
    raise exception 'owner identity presentation drift';
  end if;
  before:=replace(pg_get_functiondef('internal.get_my_frontend_identity_state()'::regprocedure),E'\r\n',E'\n');
  after:=replace(before,'internal.verification_artifacts_ready(s.id)','internal.verification_evidence_reviewed(s.id)');
  if after=before then raise exception 'reviewed identity presentation anchor missing';end if;
  execute after;
end$$;
notify pgrst,'reload schema';
commit;
