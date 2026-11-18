# Joins the dump's row counts (first file, from dump-row-counts.awk) with the
# live counts (second file, from backup-manifest.sql) into ROW-COUNTS.tsv:
# schema, table, live_rows, dump_rows. dump_rows is "not_in_dump" when the dump
# has no data section for the table; live_rows is "no_access" when the backup
# role cannot read it.
#
# -v app_schemas=api,private,... names the schemas whose tables must all be in
# the dump and readable. The number of tables there that are not is written to
# the file named by -v gaps_file, so the job can fail visibly.
# Used by .github/workflows/database-backup.yml; tested in
# ci-honest-reporting.test.ts.
BEGIN {
  FS = "\t"
  OFS = "\t"
  split(app_schemas, names, ",")
  for (i in names) app[names[i]] = 1
  gaps = 0
}
FILENAME == ARGV[1] { dump[$1 FS $2] = $3; next }
FNR == 1 { print "schema", "table", "live_rows", "dump_rows" }
{
  key = $1 FS $2
  dumped = "not_in_dump"
  if (key in dump) dumped = dump[key]
  print $1, $2, $3, dumped
  if (($1 in app) && ($3 == "no_access" || dumped == "not_in_dump")) gaps++
}
END { print gaps > gaps_file }
