/**
 * Minimal in-memory stand-in for the Supabase query builder, for unit tests
 * of business verification services. Supports the filters those services
 * use: eq, neq, in, not(col,"is",null), is(col,null), order, limit, and
 * select / insert / update / delete with maybeSingle / single.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export function createFakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  let tick = 0;

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let patch: Row = {};
    let inserted: Row[] = [];
    let limit = Infinity;
    const rows = () => (tables[table] ??= []);

    const run = () => {
      if (mode === "insert") {
        for (const r of inserted) {
          r.id ??= `${table}-${rows().length + 1}`;
          r.created_at ??= new Date().toISOString();
          r.updated_at ??= new Date(Date.now() + tick++).toISOString();
          rows().push(r);
        }
        return inserted;
      }
      const matched = rows()
        .filter((r) => filters.every((f) => f(r)))
        .slice(0, limit);
      if (mode === "update") {
        for (const r of matched) {
          Object.assign(r, patch);
          if ("updated_at" in r) r.updated_at = new Date(Date.now() + 1000 + tick++).toISOString();
        }
      }
      if (mode === "delete") tables[table] = rows().filter((r) => !matched.includes(r));
      return matched;
    };

    const api = {
      select: () => api,
      insert: (value: Row | Row[]) => {
        mode = "insert";
        inserted = (Array.isArray(value) ? value : [value]).map((v) => ({ ...v }));
        return api;
      },
      update: (value: Row) => {
        mode = "update";
        patch = value;
        return api;
      },
      delete: () => {
        mode = "delete";
        return api;
      },
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), api),
      neq: (col: string, v: unknown) => (filters.push((r) => r[col] !== v), api),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), api),
      not: (col: string, _op: string, _v: null) => (filters.push((r) => r[col] != null), api),
      is: (col: string, _v: null) => (filters.push((r) => r[col] == null), api),
      order: () => api,
      limit: (n: number) => ((limit = n), api),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const data = run()[0] ?? null;
        return { data, error: data ? null : { message: "not found" } };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve),
    };
    return api;
  }

  return {
    tables,
    client: {
      from: (table: string) => builder(table),
      auth: {
        admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }) },
      },
    },
  };
}
