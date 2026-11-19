# Rows per COPY section of a `supabase db dump --use-copy --data-only` file,
# as "schema<TAB>table<TAB>rows". COPY text format escapes newlines inside
# values, so every line up to the closing \. is exactly one row. Used by
# .github/workflows/database-backup.yml; tested in ci-honest-reporting.test.ts.
BEGIN { OFS = "\t" }
/^COPY / {
  name = $2
  gsub(/"/, "", name)
  rows = 0
  inside = 1
  next
}
inside && $0 == "\\." {
  schema = name
  sub(/\..*$/, "", schema)
  table = name
  sub(/^[^.]*\./, "", table)
  print schema, table, rows
  inside = 0
  next
}
inside { rows++ }
