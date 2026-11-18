# Joins the dump's row counts (first file, from dump-row-counts.awk) with the
# live counts (second file, from backup-manifest.sql) into ROW-COUNTS.tsv:
# schema, table, live_rows, dump_rows. dump_rows is "not_in_dump" when the dump
# has no data section for the table; live_rows is "no_access" when the backup
# role cannot read it.
#
# -v app_schemas=api,private,... names the schemas whose tables must be fully
# in the dump. A table there is a gap when it is unreadable, has no data
# section, has rows live but none in the dump, or has more live rows than
# dumped rows beyond the tolerance. The number of gaps is written to the file
# named by -v gaps_file, so the job can fail visibly.
#
# Tolerance: the live count is read a few seconds to minutes after the dump's
# snapshot, so rows written in between can make it higher (never the dump).
# At this site's write rate that window adds a handful of rows, so up to 50
# rows or 1% of the table (whichever is larger) is accepted; a dump that lost
# data is short by far more. Fewer live rows than dumped (deletes, retention
# sweeps during the dump) is never a gap.
#
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
  if (!($1 in app)) next
  if ($3 == "no_access" || dumped == "not_in_dump") { gaps++; next }
  live = $3 + 0
  rows = dumped + 0
  allowed = live * 0.01
  if (allowed < 50) allowed = 50
  if ((live > 0 && rows == 0) || live - rows > allowed) gaps++
}
END { print gaps > gaps_file }
