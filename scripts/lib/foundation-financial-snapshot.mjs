// Full ordered five-table state, hashed inside Postgres to bound fixture output.
export function captureFoundationFinancialState(sql) {
  const financialTables = [
    "payments",
    "invoices",
    "post_activations",
    "post_addon_windows",
    "entitlements",
  ];
  const finances = () => {
    const rows = financialTables
      .map(
        (table) =>
          `'${table}',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from private.${table} t)`
      )
      .join(",");
    const counts = financialTables
      .map((table) => `'${table}',(select count(*) from private.${table})`)
      .join(",");
    // Hash every complete ordered row inside PostgreSQL. The full browse fixture
    // has >10,000 activations; returning its JSON exceeds the process output cap.
    return sql(`select jsonb_build_object(
      'sha256',encode(sha256(convert_to(snapshot::text,'UTF8')),'hex'),
      'bytes',octet_length(snapshot::text),
      'rows',jsonb_build_object(${counts}))
      from (select jsonb_build_object(${rows}) as snapshot) snapshots;`);
  };
  return finances();
}
