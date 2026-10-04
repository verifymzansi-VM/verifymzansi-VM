import { createHash } from "node:crypto";

export const SECURITY_CONTROL_QUERY = `
WITH RECURSIVE functions AS (
  SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (
    'current_staff_role','intro_trial_offer','is_current_organisation_admin',
    'organisation_directory','organisation_public_stats','public_business_affiliations','public_sponsor_directory'
  )
  UNION
  SELECT child.oid FROM functions f JOIN pg_proc parent ON parent.oid=f.oid
  CROSS JOIN LATERAL regexp_matches(parent.prosrc, 'public\\.([a-z_]+)\\s*\\(', 'g') called
  JOIN pg_proc child ON child.proname=called[1]
  JOIN pg_namespace n ON n.oid=child.pronamespace AND n.nspname='public'
)
SELECT jsonb_build_object(
  'roles', (SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,
    'schemaCreate',has_schema_privilege(rolname,'public','CREATE')) ORDER BY rolname)
    FROM pg_roles WHERE rolname IN ('anon','authenticated')),
  'functions', (SELECT jsonb_agg(jsonb_build_object(
    'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'kind',p.prokind,
    'language',l.lanname,'returns',pg_get_function_result(p.oid),'volatility',p.provolatile,
    'securityDefiner',p.prosecdef,'settings',p.proconfig,'source',p.prosrc,'owner',r.rolname,
    'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'publicExecute',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) ORDER BY p.proname,p.oid)
    FROM functions f JOIN pg_proc p ON p.oid=f.oid JOIN pg_roles r ON r.oid=p.proowner
    JOIN pg_language l ON l.oid=p.prolang),
  'tables', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'owner',r.rolname,
    'policyCount',(SELECT count(*) FROM pg_policy pol WHERE pol.polrelid=c.oid),
    'anonAccess',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'),
    'authenticatedAccess',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='public' AND c.relname IN ('content_shares','content_views','media_storage_usage','organisation_admin_invites'))
) AS controls;
`;

export interface FunctionControl {
  name: string;
  args: string;
  kind: string;
  language: string;
  returns: string;
  volatility: string;
  securityDefiner: boolean;
  settings: string[] | null;
  source: string;
  owner: string;
  anonExecute: boolean;
  authenticatedExecute: boolean;
  publicExecute: boolean;
}
export interface TableControl {
  name: string;
  kind: string;
  rls: boolean;
  owner: string;
  policyCount: number;
  anonAccess: boolean;
  authenticatedAccess: boolean;
}
export interface SecurityControls {
  roles: Array<{ name: string; superuser: boolean; bypassRls: boolean; schemaCreate: boolean }>;
  functions: FunctionControl[];
  tables: TableControl[];
}
export interface SecurityControlReview {
  schemaVersion: 1;
  reviewedAt: string;
  rationale: string;
  functions: Array<Omit<FunctionControl, "source"> & { sourceHash: string; migration: string }>;
  tables: TableControl[];
}

export function functionSourceHash(source: string): string {
  return createHash("sha256").update(source.replace(/\r\n/g, "\n").trim()).digest("base64url");
}

function validFunctionMetadata(fn: unknown): fn is FunctionControl {
  if (!fn || typeof fn !== "object") return false;
  const value = fn as Record<string, unknown>;
  return (
    ["name", "args", "kind", "language", "returns", "volatility", "owner"].every(
      (key) => typeof value[key] === "string"
    ) &&
    ["securityDefiner", "anonExecute", "authenticatedExecute", "publicExecute"].every(
      (key) => typeof value[key] === "boolean"
    ) &&
    value.kind === "f" &&
    value.owner === "postgres" &&
    ["sql", "plpgsql"].includes(String(value.language)) &&
    ["s", "i"].includes(String(value.volatility)) &&
    Array.isArray(value.settings) &&
    value.settings.length === 1 &&
    value.settings[0] === "search_path=pg_catalog, public"
  );
}

/** Exact attestation only: no names-only exemptions or environment overrides. */
export function inspectSecurityControls(
  controls: unknown,
  review: SecurityControlReview
): { tables: Set<string>; functions: Set<string>; errors: string[] } {
  const result = {
    tables: new Set<string>(),
    functions: new Set<string>(),
    errors: [] as string[],
  };
  if (!controls || typeof controls !== "object") {
    result.errors.push("Missing security control metadata");
    return result;
  }
  const observed = controls as Partial<SecurityControls>;
  if (
    !review ||
    review.schemaVersion !== 1 ||
    !review.reviewedAt ||
    !review.rationale ||
    !Array.isArray(review.functions) ||
    !review.functions.length ||
    !Array.isArray(review.tables) ||
    !review.tables.length ||
    !review.functions.every(
      (fn) =>
        validFunctionMetadata(fn) &&
        typeof fn.sourceHash === "string" &&
        typeof fn.migration === "string"
    ) ||
    !review.tables.every((table) => table && typeof table.name === "string") ||
    new Set(review.functions.map((fn) => `${fn.name}(${fn.args})`)).size !==
      review.functions.length ||
    new Set(review.tables.map((table) => table.name)).size !== review.tables.length ||
    !Array.isArray(observed.roles) ||
    observed.roles.length !== 2 ||
    !["anon", "authenticated"].every((name) =>
      observed.roles?.some(
        (role) =>
          role?.name === name &&
          role.superuser === false &&
          role.bypassRls === false &&
          role.schemaCreate === false
      )
    )
  ) {
    result.errors.push("Invalid review or browser role/schema privileges");
    return result;
  }
  // All reviewed public helper dependencies must match, including overloads.
  if (!Array.isArray(observed.functions) || observed.functions.length !== review.functions.length) {
    result.errors.push("Function dependency inventory changed or unavailable");
  } else {
    let functionsMatch = true;
    for (const expected of review.functions) {
      const matches = observed.functions.filter(
        (fn) => fn?.name === expected.name && fn.args === expected.args
      );
      const actual = matches[0];
      if (
        matches.length !== 1 ||
        !validFunctionMetadata(actual) ||
        typeof actual.source !== "string" ||
        typeof actual.securityDefiner !== "boolean" ||
        !/^[A-Za-z0-9_-]{43}$/.test(expected.sourceHash) ||
        functionSourceHash(actual.source) !== expected.sourceHash ||
        ![
          "kind",
          "language",
          "returns",
          "volatility",
          "securityDefiner",
          "owner",
          "anonExecute",
          "authenticatedExecute",
          "publicExecute",
        ].every(
          (key) => actual[key as keyof FunctionControl] === expected[key as keyof typeof expected]
        ) ||
        JSON.stringify(actual.settings) !== JSON.stringify(expected.settings)
      ) {
        functionsMatch = false;
        result.errors.push(`Unreviewed function state: ${expected.name}(${expected.args})`);
      }
    }
    if (functionsMatch) for (const fn of review.functions) result.functions.add(fn.name);
  }
  if (!Array.isArray(observed.tables) || observed.tables.length !== review.tables.length)
    result.errors.push("Table inventory changed or unavailable");
  else
    for (const expected of review.tables) {
      const matches = observed.tables.filter((table) => table?.name === expected.name);
      const actual = matches[0];
      if (
        matches.length === 1 &&
        actual?.kind === "r" &&
        actual.rls === true &&
        actual.owner === "postgres" &&
        actual.policyCount === 0 &&
        actual.anonAccess === false &&
        actual.authenticatedAccess === false &&
        ["name", "kind", "rls", "owner", "policyCount", "anonAccess", "authenticatedAccess"].every(
          (key) => actual[key as keyof TableControl] === expected[key as keyof TableControl]
        )
      )
        result.tables.add(actual.name);
      else result.errors.push(`Unreviewed table state: ${expected.name}`);
    }
  return result;
}

export interface SecurityAdvisorLint {
  name: string;
  title: string;
  level: string;
  detail?: string;
  remediation?: string;
}

export function classifySecurityLint(
  lint: SecurityAdvisorLint,
  plan: string,
  controls: unknown,
  review: SecurityControlReview
): {
  lint: SecurityAdvisorLint;
  state: "actionable" | "plan-blocked" | "reviewed-control";
  reason: string;
} {
  if (lint.name === "auth_leaked_password_protection" && plan === "free") {
    return {
      lint,
      state: "plan-blocked",
      reason:
        "Native breached-password protection requires Supabase Pro or above; strict mode remains blocking.",
    };
  }
  const attestation = inspectSecurityControls(controls, review);
  const detail = lint.detail?.replace(/\\`/g, "`") ?? "";
  if (lint.name === "rls_enabled_no_policy") {
    const table = /^Table `public\.([a-z_]+)` has RLS enabled, but no policies exist$/.exec(
      detail
    )?.[1];
    if (table && attestation.tables.has(table))
      return {
        lint,
        state: "reviewed-control",
        reason: `Service-only ${table}: RLS enabled, no browser-role table or column privileges, and no browser bypass/schema-write rights; reviewed ${review.reviewedAt}.`,
      };
  }
  const role =
    lint.name === "anon_security_definer_function_executable"
      ? "anon"
      : lint.name === "authenticated_security_definer_function_executable"
        ? "authenticated"
        : null;
  if (role) {
    const match =
      /^Function `public\.([a-z_]+)\([^`]*\)` can be executed by the `(anon|authenticated)` role as a `SECURITY DEFINER` function/.exec(
        detail
      );
    const name = match?.[1];
    const observed = controls as Partial<SecurityControls> | null;
    const fn = Array.isArray(observed?.functions)
      ? observed.functions.find((item) => item?.name === name)
      : undefined;
    if (
      name &&
      match?.[2] === role &&
      attestation.functions.has(name) &&
      fn?.securityDefiner === true &&
      fn[role === "anon" ? "anonExecute" : "authenticatedExecute"] === true
    )
      return {
        lint,
        state: "reviewed-control",
        reason: `Exact reviewed ${name} body, signature, ownership, search path, grants and complete public helper dependency graph match; reviewed ${review.reviewedAt}.`,
      };
  }
  return {
    lint,
    state: "actionable",
    reason: "Unreviewed finding or control drift; remains blocking.",
  };
}
