-- Contract step of 20261113021223_staff_payment_fixes.sql (pull request 213):
-- retire the three staff payment commands that update replaced.
--
-- 20261113021223_staff_payment_fixes.sql (applied 2026-11-13) added the staff
-- payments list, activation and the refund commands that need Ozow's reference,
-- a reason code and, above R1,000, a second approver. The website no longer
-- calls the earlier commands. Until they go, the earlier whole-payment and
-- single-slot reversal commands can still reverse a payment without a
-- reference or a reason code whenever no refund is waiting for approval.
--
-- In one transaction it:
--
-- 1. Drops the three earlier API commands (each a one-line wrapper of an
--    internal function): api.record_frontend_staff_payment_reversal(p_id,
--    p_kind, p_reason), api.record_staff_slot_reversal(p_line_id, p_kind,
--    p_reason) and api.get_frontend_staff_payments(p_page, p_status). Every
--    API command keeps exactly one audience (runtime-api-manifest.json and the
--    native access matrix require it), so a command nobody may call is
--    removed rather than left without a grant. Replacements:
--    api.record_staff_payment_refund, api.record_staff_slot_refund and
--    api.get_staff_payment_list (with api.approve_staff_payment_refund,
--    api.decline_staff_payment_refund and api.activate_staff_paid_payment).
-- 2. Closes the internal functions behind them to the API roles:
--    internal.record_frontend_staff_payment_reversal(uuid,text,text) and
--    internal.get_frontend_staff_payments(integer,text) have no other caller;
--    internal.record_staff_slot_reversal(uuid,text,text) stays as the step
--    that api.record_staff_slot_refund and api.approve_staff_payment_refund
--    take, through internal functions that run as their owner (security
--    definer), so they keep working without the grant. No function body
--    changes and no data changes; the service's api.reverse_payment is
--    unchanged.
--
-- It refuses (55000) unless the replacement commands are present with the
-- reviewed bodies of 20261113021223_staff_payment_fixes.sql, and unless each
-- earlier command is either absent or still its reviewed one-line wrapper.
-- Running it again changes nothing.
--
-- ORDER: merge the pull request first, then apply (a contract step: no
-- website release calls these commands, and the release from this pull request
-- no longer lists them in its runtime manifest).
-- Read-only preflight:
-- ../preflight/20261113085340_retire_old_staff_reversal_commands.check.sql.
-- Rollback: ../rollback/20261113085340_retire_old_staff_reversal_commands.down.sql.
begin;
set local lock_timeout='5s';

do $$
begin
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_payment_list(integer,text)')) is distinct from 'a96efb8aa9552502327936ecf4e05d5f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_payment_refund(uuid,text,text,text,text)')) is distinct from 'c88c371f4398b69da822669fe832dac9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_slot_refund(uuid,text,text,text,text)')) is distinct from '74bae46217113296da99631b7a316e76'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.approve_staff_payment_refund(uuid)')) is distinct from 'c940eeb3f76b9bdd82e4377909b97cc0'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.decline_staff_payment_refund(uuid,text)')) is distinct from 'e05112535fb4c6e13589f4f339a74dec'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.activate_staff_paid_payment(uuid,text)')) is distinct from '38ff2863e1c58cd9cb7d6dd22636ad10'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_refund(uuid,text,text,text,text)')) is distinct from 'a315072d628da2b6f164491cbc1a0076'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.approve_staff_payment_refund(uuid)')) is distinct from 'f757a5e1ac7aa4a199dbcd05f5465083'
    or not coalesce((select prosecdef from pg_proc where oid=to_regprocedure('internal.record_staff_slot_refund(uuid,text,text,text,text)')), false)
    or not coalesce((select prosecdef from pg_proc where oid=to_regprocedure('internal.approve_staff_payment_refund(uuid)')), false) then
    raise exception 'retire old staff reversal commands: 20261113021223_staff_payment_fixes.sql is not applied with its reviewed bodies'
      using errcode='55000';
  end if;
  if to_regprocedure('internal.record_frontend_staff_payment_reversal(uuid,text,text)') is null
    or to_regprocedure('internal.get_frontend_staff_payments(integer,text)') is null
    or to_regprocedure('internal.record_staff_slot_reversal(uuid,text,text)') is null then
    raise exception 'retire old staff reversal commands: an internal staff payment function is missing'
      using errcode='55000';
  end if;
  if coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_frontend_staff_payment_reversal(uuid,text,text)')), 'aabd8d6fa4192d2930525de072064479') <> 'aabd8d6fa4192d2930525de072064479'
    or coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_slot_reversal(uuid,text,text)')), '2a52fbde1bcd5076472a92751af0bedb') <> '2a52fbde1bcd5076472a92751af0bedb'
    or coalesce((select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_frontend_staff_payments(integer,text)')), '36df30d37390ab583f50bca554a1dfaa') <> '36df30d37390ab583f50bca554a1dfaa' then
    raise exception 'retire old staff reversal commands: an earlier command is not its reviewed wrapper; review it before removing it'
      using errcode='55000';
  end if;
end$$;

-- 1. The three earlier API commands.
drop function if exists api.record_frontend_staff_payment_reversal(uuid,text,text);
drop function if exists api.record_staff_slot_reversal(uuid,text,text);
drop function if exists api.get_frontend_staff_payments(integer,text);

-- 2. The internal functions behind them: no API role may call them directly.
revoke all on function internal.record_frontend_staff_payment_reversal(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function internal.get_frontend_staff_payments(integer,text) from public, anon, authenticated, service_role;
revoke all on function internal.record_staff_slot_reversal(uuid,text,text) from public, anon, authenticated, service_role;

commit;
