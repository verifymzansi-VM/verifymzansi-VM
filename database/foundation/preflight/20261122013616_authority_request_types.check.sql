-- Read-only preflight for updates/20261122013616_authority_request_types.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the four replaced functions have their reviewed
-- bodies and the update's columns, check and command are absent (update not
-- applied), or everything is the update's (already applied), and counts:
-- - "disclosures": rows in private.identity_disclosures (kept as they are);
-- - after the update, "under rule D9": rows with the issuing court or station,
--   the number called and who confirmed it, and "urgent": urgent_life_risk
--   rows among them.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.open_identity_disclosure(text,text,text,text,text,boolean)',
      'b72391179f1d942af39f268d5a8a812c', '1e94be28e68801c02330175c4b28135d'),
    ('internal.read_identity_disclosure(uuid,text,uuid)',
      '7f80eff0035ca2abfdaea6cf32712e2c', '63782df66dd597f8ab846179fdeb60d0'),
    ('internal.identity_disclosure_record(private.identity_disclosures,uuid)',
      '28da9a89df24f4b133f1419725fbd084', 'd3059f65a766c2f37e70edbca7623b2d'),
    ('internal.identity_disclosure_material(uuid,uuid)',
      '83fa3856da8d655a03cc5137c75c1625', '31e6fa632182fb300b5a8ba511ca2208')
  ) v(sig, reviewed, updated)
),
shape as (
  select (to_regprocedure('api.open_authority_request(text,text,text,text,text,text,text,text,boolean)') is not null)::integer
    + (to_regprocedure('internal.open_authority_request(text,text,text,text,text,text,text,text,boolean)') is not null)::integer
    + (select count(*)::integer from pg_attribute a where a.attrelid = 'private.identity_disclosures'::regclass
        and a.attname in ('issued_by', 'confirmed_number', 'confirmed_by') and not a.attisdropped)
    + (select count(*)::integer from pg_constraint c where c.conrelid = 'private.identity_disclosures'::regclass
        and c.conname = 'identity_disclosures_confirmation_check')
    as present
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
logs as (
  -- to_jsonb reads the new columns without naming them, so this also runs
  -- before the update.
  select count(*) as disclosures,
    count(*) filter (where to_jsonb(d) ->> 'issued_by' is not null) as d9,
    count(*) filter (where d.request_type = 'urgent_life_risk') as urgent
  from private.identity_disclosures d
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present (' || present || ' of 6 objects)'
    from state, shape
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not ((reviewed = total and present = 0) or (updated = total and present = 6))
)
select 'summary' as kind,
  'authority request types: '
    || case when exists (select 1 from problems) then 'unexpected state'
         when st.reviewed = st.total then 'update not applied'
         else 'already applied' end
    || '; disclosures: ' || l.disclosures
    || case when st.updated = st.total and sh.present = 6 and not exists (select 1 from problems)
         then '; under rule D9: ' || l.d9 || '; urgent: ' || l.urgent else '' end as detail
from state st, shape sh, logs l
union all
select kind, detail from problems;
