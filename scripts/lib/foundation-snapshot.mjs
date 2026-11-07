// Renders a readable "current schema" of the foundation (production) database
// from a replayed catalogue: one file per function, table and view, plus
// schemas, sequences and platform hooks. Reviewers read these files instead of
// chains of patches. Output depends only on the catalogue, never on the
// operating system: LF line endings and byte-order ("C") sorting throughout.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SNAPSHOT_DIR = "database/foundation/current";
export const APP_SCHEMAS = ["api", "internal", "private"];
const HEADER =
  "-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.\n" +
  "-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.\n";
const SAFE_NAME = /^[a-z_][a-z0-9_]*$/;
const schemaList = APP_SCHEMAS.map((name) => `'${name}'`).join(",");

const aclJson = (acl, kind, owner) => `coalesce((
    select json_agg(json_build_object(
      'grantee', case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
      'privilege', lower(a.privilege_type),
      'grantable', a.is_grantable
    ) order by case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end collate "C",
      a.privilege_type collate "C")
    from aclexplode(coalesce(${acl}, acldefault('${kind}', ${owner}))) a
    where a.grantee <> ${owner}
  ), '[]'::json)`;

const notExtensionMember = (classTable, oid) => `not exists (
    select 1 from pg_depend d
    where d.classid = '${classTable}'::regclass and d.objid = ${oid} and d.deptype = 'e'
  )`;

/** Catalogue queries; each returns one row with a json column `v`. */
export const SNAPSHOT_QUERIES = {
  schemas: `select coalesce(json_agg(json_build_object(
      'name', n.nspname,
      'ident', quote_ident(n.nspname),
      'owner', quote_ident(pg_get_userbyid(n.nspowner)),
      'grants', ${aclJson("n.nspacl", "n", "n.nspowner")},
      'comment', obj_description(n.oid, 'pg_namespace')
    ) order by n.nspname collate "C"), '[]'::json) as v
    from pg_namespace n where n.nspname in (${schemaList})`,
  extensions: `select coalesce(json_agg(json_build_object(
      'name', e.extname, 'schema', quote_ident(n.nspname), 'version', e.extversion
    ) order by e.extname collate "C"), '[]'::json) as v
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname not in ('plpgsql', 'plpgsql_check')`,
  defaultPrivileges: `select coalesce(json_agg(json_build_object(
      'role', quote_ident(pg_get_userbyid(d.defaclrole)),
      'schema', case when d.defaclnamespace = 0 then null else quote_ident(d.defaclnamespace::regnamespace::text) end,
      'objtype', d.defaclobjtype,
      'grants', coalesce((select json_agg(json_build_object(
          'grantee', case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
          'privilege', lower(a.privilege_type)
        ) order by case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end collate "C",
          a.privilege_type collate "C")
        from aclexplode(d.defaclacl) a), '[]'::json)
    ) order by pg_get_userbyid(d.defaclrole) collate "C",
      coalesce(d.defaclnamespace::regnamespace::text, '') collate "C", d.defaclobjtype::text collate "C"), '[]'::json) as v
    from pg_default_acl d`,
  eventTriggers: `select coalesce(json_agg(json_build_object(
      'name', quote_ident(e.evtname), 'event', e.evtevent, 'function', e.evtfoid::regproc::text,
      'tags', e.evttags, 'enabled', e.evtenabled
    ) order by e.evtname collate "C"), '[]'::json) as v
    from pg_event_trigger e`,
  functions: `select coalesce(json_agg(json_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'kind', p.prokind,
      'signature', p.oid::regprocedure::text,
      'definition', case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end,
      'owner', quote_ident(pg_get_userbyid(p.proowner)),
      'grants', ${aclJson("p.proacl", "f", "p.proowner")},
      'comment', obj_description(p.oid, 'pg_proc')
    ) order by n.nspname collate "C", p.proname collate "C",
      pg_get_function_identity_arguments(p.oid) collate "C"), '[]'::json) as v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in (${schemaList}) and ${notExtensionMember("pg_proc", "p.oid")}`,
  relations: `select coalesce(json_agg(json_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'ident', quote_ident(n.nspname) || '.' || quote_ident(c.relname),
      'owner', quote_ident(pg_get_userbyid(c.relowner)),
      'options', c.reloptions,
      'rls', c.relrowsecurity,
      'forceRls', c.relforcerowsecurity,
      'view', case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) end,
      'comment', obj_description(c.oid, 'pg_class'),
      'grants', ${aclJson("c.relacl", "r", "c.relowner")},
      'columns', coalesce((select json_agg(json_build_object(
          'name', quote_ident(a.attname),
          'type', format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'default', pg_get_expr(ad.adbin, ad.adrelid),
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'collation', case when a.attcollation <> t.typcollation then quote_ident(co.collname) end,
          'comment', col_description(c.oid, a.attnum),
          'grants', coalesce((select json_agg(json_build_object(
              'grantee', case when g.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(g.grantee)) end,
              'privilege', lower(g.privilege_type)
            ) order by case when g.grantee = 0 then 'public' else pg_get_userbyid(g.grantee) end collate "C",
              g.privilege_type collate "C")
            from aclexplode(a.attacl) g), '[]'::json)
        ) order by a.attnum)
        from pg_attribute a
        join pg_type t on t.oid = a.atttypid
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
        left join pg_collation co on co.oid = a.attcollation
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]'::json),
      'constraints', coalesce((select json_agg(json_build_object(
          'name', quote_ident(k.conname), 'definition', pg_get_constraintdef(k.oid, true)
        ) order by k.conname collate "C")
        from pg_constraint k where k.conrelid = c.oid and k.contype <> 'n'), '[]'::json),
      'indexes', coalesce((select json_agg(pg_get_indexdef(i.indexrelid)
          order by ic.relname collate "C")
        from pg_index i join pg_class ic on ic.oid = i.indexrelid
        where i.indrelid = c.oid
          and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.conrelid = c.oid)
        ), '[]'::json),
      'triggers', coalesce((select json_agg(pg_get_triggerdef(tg.oid, true) order by tg.tgname collate "C")
        from pg_trigger tg where tg.tgrelid = c.oid and not tg.tgisinternal), '[]'::json),
      'policies', coalesce((select json_agg(json_build_object(
          'name', quote_ident(po.polname),
          'permissive', po.polpermissive,
          'command', po.polcmd,
          'roles', (select coalesce(array_agg(case when r = 0 then 'public' else quote_ident(pg_get_userbyid(r)) end
              order by case when r = 0 then 'public' else pg_get_userbyid(r) end collate "C"), '{}')
            from unnest(po.polroles) r),
          'using', pg_get_expr(po.polqual, po.polrelid),
          'check', pg_get_expr(po.polwithcheck, po.polrelid)
        ) order by po.polname collate "C")
        from pg_policy po where po.polrelid = c.oid), '[]'::json)
    ) order by n.nspname collate "C", c.relname collate "C"), '[]'::json) as v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in (${schemaList}) and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
  sequences: `select coalesce(json_agg(json_build_object(
      'ident', quote_ident(n.nspname) || '.' || quote_ident(c.relname),
      'type', format_type(s.seqtypid, null),
      'increment', s.seqincrement::text, 'min', s.seqmin::text, 'max', s.seqmax::text,
      'start', s.seqstart::text, 'cache', s.seqcache::text, 'cycle', s.seqcycle,
      'ownedBy', (select quote_ident(tn.nspname) || '.' || quote_ident(tc.relname) || '.' || quote_ident(ta.attname)
        from pg_depend d
        join pg_class tc on tc.oid = d.refobjid
        join pg_namespace tn on tn.oid = tc.relnamespace
        join pg_attribute ta on ta.attrelid = d.refobjid and ta.attnum = d.refobjsubid
        where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i')
        limit 1),
      'owner', quote_ident(pg_get_userbyid(c.relowner)),
      'grants', ${aclJson("c.relacl", "s", "c.relowner")}
    ) order by n.nspname collate "C", c.relname collate "C"), '[]'::json) as v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_sequence s on s.seqrelid = c.oid
    where n.nspname in (${schemaList}) and c.relkind = 'S'`,
  platformHooks: `select coalesce(json_agg(pg_get_triggerdef(tg.oid, true)
      order by n.nspname collate "C", c.relname collate "C", tg.tgname collate "C"), '[]'::json) as v
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where not tg.tgisinternal and n.nspname not in (${schemaList}) and pn.nspname in (${schemaList})`,
};

/**
 * Runs catalogue queries against an open PGlite database holding the replay.
 * Every query is a single row with one json column `v`. The search path is
 * pinned to pg_catalog so every other name in generated definitions is
 * schema-qualified.
 */
export function pgliteJson(db) {
  return async (sql) => {
    await db.exec("set search_path to pg_catalog");
    const result = await db.query(sql);
    return result.rows[0].v;
  };
}

/** Reads the snapshot catalogue through `json(sql)` (see pgliteJson). */
export async function readSnapshotCatalogue(json) {
  const catalogue = {};
  for (const [name, sql] of Object.entries(SNAPSHOT_QUERIES)) catalogue[name] = await json(sql);
  return catalogue;
}

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const lf = (text) => text.replaceAll("\r\n", "\n");
const byBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** One grant statement per grantee (and grant option), privileges in catalogue order. */
function grantLines(grants, object) {
  const grouped = new Map();
  for (const grant of grants) {
    const key = `${grant.grantee}${grant.grantable ? " with grant option" : ""}`;
    grouped.set(key, [...(grouped.get(key) ?? []), grant.privilege]);
  }
  return [...grouped].map(
    ([grantee, privileges]) => `grant ${privileges.join(", ")} on ${object} to ${grantee};`
  );
}

function safeFileName(name, what) {
  if (!SAFE_NAME.test(name))
    throw new Error(`Unsupported ${what} name for a snapshot file: ${name}`);
  return name;
}

function renderFunction(fn) {
  if (!fn.definition) throw new Error(`Unsupported routine kind ${fn.kind}: ${fn.signature}`);
  const object = `${fn.kind === "p" ? "procedure" : "function"} ${fn.signature}`;
  const lines = [lf(fn.definition).trimEnd() + ";", `alter ${object} owner to ${fn.owner};`];
  lines.push(`revoke all on ${object} from public;`, ...grantLines(fn.grants, object));
  if (fn.comment !== null) lines.push(`comment on ${object} is ${literal(lf(fn.comment))};`);
  return lines.join("\n");
}

function columnLine(column) {
  let line = `  ${column.name} ${column.type}`;
  if (column.collation) line += ` collate ${column.collation}`;
  if (column.identity) {
    line += ` generated ${column.identity === "a" ? "always" : "by default"} as identity`;
  } else if (column.generated === "s") {
    line += ` generated always as (${column.default}) stored`;
  } else if (column.default !== null) {
    line += ` default ${column.default}`;
  }
  if (column.notNull) line += " not null";
  return line;
}

const POLICY_COMMANDS = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };

function renderRelationExtras(relation, kindWord, lines) {
  lines.push(`alter ${kindWord} ${relation.ident} owner to ${relation.owner};`);
  if (relation.rls) lines.push(`alter table ${relation.ident} enable row level security;`);
  if (relation.forceRls) lines.push(`alter table ${relation.ident} force row level security;`);
  for (const index of relation.indexes) lines.push(`${index};`);
  for (const trigger of relation.triggers) lines.push(`${trigger};`);
  for (const policy of relation.policies) {
    let line = `create policy ${policy.name} on ${relation.ident}`;
    line += ` as ${policy.permissive ? "permissive" : "restrictive"}`;
    line += ` for ${POLICY_COMMANDS[policy.command]} to ${policy.roles.join(", ")}`;
    if (policy.using !== null) line += `\n  using (${policy.using})`;
    if (policy.check !== null) line += `\n  with check (${policy.check})`;
    lines.push(`${line};`);
  }
  lines.push(`revoke all on ${relation.ident} from public;`);
  lines.push(...grantLines(relation.grants, relation.ident));
  for (const column of relation.columns) {
    const grouped = new Map();
    for (const grant of column.grants) {
      grouped.set(grant.grantee, [...(grouped.get(grant.grantee) ?? []), grant.privilege]);
    }
    for (const [grantee, privileges] of grouped) {
      const list = privileges.map((privilege) => `${privilege} (${column.name})`).join(", ");
      lines.push(`grant ${list} on ${relation.ident} to ${grantee};`);
    }
  }
  if (relation.comment !== null) {
    lines.push(`comment on ${kindWord} ${relation.ident} is ${literal(lf(relation.comment))};`);
  }
  for (const column of relation.columns) {
    if (column.comment !== null) {
      lines.push(
        `comment on column ${relation.ident}.${column.name} is ${literal(lf(column.comment))};`
      );
    }
  }
}

function renderTable(relation) {
  const body = [
    ...relation.columns.map(columnLine),
    ...relation.constraints.map(
      (constraint) => `  constraint ${constraint.name} ${constraint.definition}`
    ),
  ];
  const options = relation.options?.length ? ` with (${relation.options.join(", ")})` : "";
  const lines = [`create table ${relation.ident} (\n${body.join(",\n")}\n)${options};`];
  renderRelationExtras(relation, "table", lines);
  return lines.join("\n");
}

function renderView(relation) {
  const materialized = relation.kind === "m";
  const options = relation.options?.length ? ` with (${relation.options.join(", ")})` : "";
  const lines = [
    `create ${materialized ? "materialized " : ""}view ${relation.ident}${options} as\n${lf(relation.view).trimEnd().replace(/;$/, "")};`,
  ];
  renderRelationExtras(relation, materialized ? "materialized view" : "view", lines);
  return lines.join("\n");
}

function renderSchemas(catalogue) {
  const lines = [];
  for (const schema of catalogue.schemas) {
    lines.push(`create schema ${schema.ident} authorization ${schema.owner};`);
    lines.push(`revoke all on schema ${schema.ident} from public;`);
    lines.push(...grantLines(schema.grants, `schema ${schema.ident}`));
    if (schema.comment !== null) {
      lines.push(`comment on schema ${schema.ident} is ${literal(lf(schema.comment))};`);
    }
  }
  for (const extension of catalogue.extensions) {
    lines.push(
      `create extension ${extension.name} with schema ${extension.schema} version ${literal(extension.version)};`
    );
  }
  const objectWords = { r: "tables", S: "sequences", f: "functions", T: "types", n: "schemas" };
  for (const entry of catalogue.defaultPrivileges) {
    const scope = entry.schema ? ` in schema ${entry.schema}` : "";
    const grants = entry.grants.length
      ? entry.grants.map((grant) => `${grant.privilege} to ${grant.grantee}`).join(", ")
      : "(none)";
    lines.push(
      `-- default privileges for role ${entry.role}${scope} on ${objectWords[entry.objtype] ?? entry.objtype}: ${grants}`
    );
  }
  for (const trigger of catalogue.eventTriggers) {
    const tags = trigger.tags?.length
      ? ` when tag in (${trigger.tags.map(literal).join(", ")})`
      : "";
    lines.push(
      `create event trigger ${trigger.name} on ${trigger.event}${tags} execute function ${trigger.function}();`
    );
    if (trigger.enabled !== "O")
      lines.push(`-- event trigger ${trigger.name} enabled state: ${trigger.enabled}`);
  }
  return lines.join("\n");
}

function renderSequences(sequences) {
  const lines = [];
  for (const sequence of sequences) {
    lines.push(
      `create sequence ${sequence.ident} as ${sequence.type} increment by ${sequence.increment}` +
        ` minvalue ${sequence.min} maxvalue ${sequence.max} start with ${sequence.start}` +
        ` cache ${sequence.cache}${sequence.cycle ? " cycle" : " no cycle"};`
    );
    if (sequence.ownedBy)
      lines.push(`alter sequence ${sequence.ident} owned by ${sequence.ownedBy};`);
    lines.push(`alter sequence ${sequence.ident} owner to ${sequence.owner};`);
    lines.push(`revoke all on sequence ${sequence.ident} from public;`);
    lines.push(...grantLines(sequence.grants, `sequence ${sequence.ident}`));
  }
  return lines.join("\n");
}

const README = `# Current foundation schema (generated)

Generated by \`pnpm db:foundation:snapshot\` from the CI replay of
\`database/foundation\` (\`candidate.sql\` plus every file in \`updates/\`). Do not
edit these files: change the schema with a reviewed file in \`updates/\`, then
regenerate and commit this folder in the same pull request. CI regenerates it
and fails on any difference.

- \`functions/<schema>/<name>.sql\`: the complete current definition, owner,
  execute grants and comment of each function (overloads share a file).
- \`tables/<schema>/<name>.sql\` and \`views/<schema>/<name>.sql\`: columns,
  constraints, indexes, triggers, row level security, policies and grants.
- \`schemas.sql\`, \`sequences.sql\`, \`platform-hooks.sql\` (foundation triggers
  on Supabase platform tables such as \`auth.users\`).

Platform stand-ins from \`replay/platform-prelude.sql\` are not included.
`;

/** Returns Map<relative path, file content> for the whole snapshot folder. */
export function renderSnapshot(catalogue) {
  const files = new Map();
  const add = (relative, body) => {
    const key = relative.toLowerCase();
    for (const existing of files.keys()) {
      if (existing.toLowerCase() === key) throw new Error(`Snapshot file name clash: ${relative}`);
    }
    files.set(relative, `${HEADER}\n${body.trimEnd()}\n`);
  };
  const functionFiles = new Map();
  for (const fn of catalogue.functions) {
    const relative = `functions/${safeFileName(fn.schema, "schema")}/${safeFileName(fn.name, "function")}.sql`;
    functionFiles.set(relative, [...(functionFiles.get(relative) ?? []), renderFunction(fn)]);
  }
  for (const [relative, parts] of functionFiles) add(relative, parts.join("\n\n"));
  for (const relation of catalogue.relations) {
    const folder = ["r", "p", "f"].includes(relation.kind) ? "tables" : "views";
    const relative = `${folder}/${safeFileName(relation.schema, "schema")}/${safeFileName(relation.name, "relation")}.sql`;
    add(relative, folder === "tables" ? renderTable(relation) : renderView(relation));
  }
  add("schemas.sql", renderSchemas(catalogue));
  add("sequences.sql", renderSequences(catalogue.sequences));
  add(
    "platform-hooks.sql",
    catalogue.platformHooks.length
      ? catalogue.platformHooks.map((t) => `${t};`).join("\n")
      : "-- none"
  );
  const sorted = new Map([...files.entries()].sort(([a], [b]) => byBytes(a, b)));
  sorted.set("README.md", README);
  return sorted;
}

function listFiles(dir, prefix = "") {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`]
  );
}

/** Lists files that are missing, changed or extra compared with `files`. */
export function snapshotDifferences(files, root = process.cwd()) {
  const dir = path.join(root, SNAPSHOT_DIR);
  const present = new Set(listFiles(dir));
  const differences = [];
  for (const [relative, content] of files) {
    if (!present.has(relative)) differences.push(`missing: ${relative}`);
    else if (lf(readFileSync(path.join(dir, relative), "utf8")) !== content) {
      differences.push(`changed: ${relative}`);
    }
    present.delete(relative);
  }
  for (const relative of [...present].sort(byBytes)) differences.push(`extra: ${relative}`);
  return differences;
}

/** Replaces the snapshot folder with `files`. */
export function writeSnapshot(files, root = process.cwd()) {
  const dir = path.join(root, SNAPSHOT_DIR);
  rmSync(dir, { recursive: true, force: true });
  for (const [relative, content] of files) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
