-- Completeness manifest for the nightly database backup
-- (.github/workflows/database-backup.yml). Run with psql from the backup
-- directory, right after the dump, with -v schemas=<comma-separated list>.
--
-- Read-only: one repeatable-read, read-only transaction, so the row counts and
-- the schema fingerprint describe the same moment. It returns only numbers and
-- catalogue hashes, never row contents. Both files go inside the encrypted
-- archive; a restore drill compares them with the restored database.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
\pset footer off

begin transaction isolation level repeatable read read only;
-- Error out instead of silently counting only the rows a policy shows.
set local row_security = off;
set local statement_timeout = '10min';

-- Exact row count of every ordinary table (and leaf partition) in the schemas
-- whose data the backup dumps: schema, table, rows. A table the backup role
-- cannot read (pg_dump skips its data too) is listed as no_access instead of
-- failing the whole manifest.
\o row-counts-live.tsv
select n.nspname, c.relname,
  case when has_table_privilege(c.oid, 'select') then
    (xpath('/row/c/text()',
      query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')
    ))[1]::text
  else 'no_access' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname = any (string_to_array(:'schemas', ','))
order by n.nspname collate "C", c.relname collate "C";

-- The foundation schema fingerprint, run exactly as fingerprint.json
-- productionCheck.howToCompare describes: category, items, md5.
set local search_path to "$user", public;
\o fingerprint.tsv
\ir ../../database/foundation/fingerprint.sql
\o
commit;
