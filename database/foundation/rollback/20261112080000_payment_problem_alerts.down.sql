-- Reviewed rollback for updates/20261112080000_payment_problem_alerts.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert (and deploy) the website
-- release that uses the update first: this rollback removes the commands that
-- release's payment notice handling and email job call. The release before it
-- does not use them and passes the deploy preflight with or without the
-- update.
-- The rollback drops the update's ten commands and its two tables, and with
-- them every recorded payment problem and daily summary record. Payments,
-- provider journal rows and everything else stay as they are: the update
-- changed no existing function, table or grant.
begin;
set local lock_timeout='5s';

do $$begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_payment_problem(uuid,text,text,boolean,text)')) is distinct from 'cd1051937fb931de8ced633770d8c9b7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_payment_problem(uuid,text,text,boolean,text)')) is distinct from '39cff72967defbf554dcbdd3d4de1fd8'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_payment_alerts(integer)')) is distinct from '3c4aab147514a52db39b641419b94b39'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.claim_payment_alerts(integer)')) is distinct from 'cc0dafa479115c493baf59f491fd79d4'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.complete_payment_alerts(uuid,boolean)')) is distinct from 'f624dcceb9c05527fa43e7f98e8c44d2'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.complete_payment_alerts(uuid,boolean)')) is distinct from '875b589441b17d72f254d2e4f474dcc7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.claim_payment_digest(integer,integer)')) is distinct from '4b00aeccb8a082bf08f8e4c189bf47cf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.claim_payment_digest(integer,integer)')) is distinct from 'a14ed70f57c9c3568b7e6041881f1f12'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.complete_payment_digest(uuid)')) is distinct from '6f334b442d5bc8a51f6ee4f51cf8f025'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.complete_payment_digest(uuid)')) is distinct from 'f8e68e7bcd1992fb2844d875d3f4bf94'
    or to_regclass('private.payment_problems') is null
    or to_regclass('private.payment_problem_digests') is null then
    raise exception 'rollback precondition: the payment problem alerts update is not applied' using errcode='55000';
  end if;
end$$;

drop function api.record_payment_problem(uuid,text,text,boolean,text);
drop function api.claim_payment_alerts(integer);
drop function api.complete_payment_alerts(uuid,boolean);
drop function api.claim_payment_digest(integer,integer);
drop function api.complete_payment_digest(uuid);
drop function internal.record_payment_problem(uuid,text,text,boolean,text);
drop function internal.claim_payment_alerts(integer);
drop function internal.complete_payment_alerts(uuid,boolean);
drop function internal.claim_payment_digest(integer,integer);
drop function internal.complete_payment_digest(uuid);
drop table private.payment_problems;
drop table private.payment_problem_digests;
commit;
