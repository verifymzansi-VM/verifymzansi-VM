// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import reviewJson from "../../scripts/security-reviews/supabase-controls.json";
import {
  SECURITY_CONTROL_QUERY,
  functionSourceHash,
  inspectSecurityControls,
  classifySecurityLint,
  type SecurityControlReview,
  type SecurityControls,
  type SecurityAdvisorLint,
} from "../../scripts/lib/supabase-security-controls";

const review = reviewJson as SecurityControlReview;
function fixture(): SecurityControls {
  return {
    roles: ["anon", "authenticated"].map((name) => ({
      name,
      superuser: false,
      bypassRls: false,
      schemaCreate: false,
    })),
    tables: structuredClone(review.tables),
    functions: review.functions.map((fn) => {
      const migration = readFileSync(`supabase/migrations/${fn.migration}`, "utf8");
      const pattern = new RegExp(
        `CREATE(?: OR REPLACE)? FUNCTION public\\.${fn.name}\\([\\s\\S]*?\\bAS\\s+(\\$[\\w]*\\$)([\\s\\S]*?)\\1`,
        "gi"
      );
      const matches = [...migration.matchAll(pattern)];
      const source = matches.at(-1)?.[2];
      if (!source) throw new Error(`Missing examined migration body: ${fn.name}`);
      expect(functionSourceHash(source)).toBe(fn.sourceHash);
      const { sourceHash: _hash, migration: _migration, ...metadata } = fn;
      return { ...structuredClone(metadata), source };
    }),
  };
}
const functionLint: SecurityAdvisorLint = {
  name: "anon_security_definer_function_executable",
  title: "Public RPC",
  level: "WARN",
  detail:
    "Function `public.current_staff_role()` can be executed by the `anon` role as a `SECURITY DEFINER` function via `/rest/v1/rpc/current_staff_role`.",
};
const tableLint: SecurityAdvisorLint = {
  name: "rls_enabled_no_policy",
  title: "No policy",
  level: "INFO",
  detail: "Table \\`public.content_views\\` has RLS enabled, but no policies exist",
};
describe("exact Supabase security control reviews", () => {
  it("pins maintained migration bodies and preserves the original finding", () => {
    const controls = fixture();
    const attestation = inspectSecurityControls(controls, review);
    expect(attestation.errors).toEqual([]);
    expect(attestation.functions.size).toBe(16);
    expect(attestation.tables.size).toBe(4);
    const classified = classifySecurityLint(functionLint, "free", controls, review);
    expect(classified.state).toBe("reviewed-control");
    expect(classified.lint).toBe(functionLint);
    expect(classifySecurityLint(tableLint, "free", controls, review).state).toBe(
      "reviewed-control"
    );
  });
  it.each([
    "source",
    "args",
    "owner",
    "language",
    "volatility",
    "returns",
    "settings",
    "anonExecute",
    "publicExecute",
  ])("keeps function %s drift blocking", (field) => {
    const controls = fixture();
    const fn = controls.functions.find((item) => item.name === "current_staff_role")!;
    Object.assign(fn, {
      [field]:
        field === "settings"
          ? ["search_path=public"]
          : field.endsWith("Execute")
            ? !fn[field as "anonExecute" | "publicExecute"]
            : `${fn[field as keyof typeof fn]} changed`,
    });
    expect(classifySecurityLint(functionLint, "free", controls, review).state).toBe("actionable");
    expect(inspectSecurityControls(controls, review).errors.length).toBeGreaterThan(0);
  });
  it("checks nested helpers and unexpected overloads instead of only the warned body", () => {
    const controls = fixture();
    controls.functions.find((fn) => fn.name === "staff_role_of")!.source += "\n-- changed helper";
    expect(classifySecurityLint(functionLint, "free", controls, review).state).toBe("actionable");
    const overload = fixture();
    overload.functions.push({ ...overload.functions[0], args: "p_user_id text" });
    expect(classifySecurityLint(functionLint, "free", overload, review).state).toBe("actionable");
  });
  it.each(["rls", "owner", "policyCount", "anonAccess", "authenticatedAccess"])(
    "keeps table %s drift blocking",
    (field) => {
      const controls = fixture();
      const table = controls.tables.find((item) => item.name === "content_views")!;
      Object.assign(table, {
        [field]:
          field === "owner" ? "anon" : field === "policyCount" ? 1 : field === "rls" ? false : true,
      });
      expect(classifySecurityLint(tableLint, "free", controls, review).state).toBe("actionable");
    }
  );
  it.each(["superuser", "bypassRls", "schemaCreate"])("refuses a browser role with %s", (field) => {
    const controls = fixture();
    Object.assign(controls.roles[0], { [field]: true });
    expect(classifySecurityLint(functionLint, "free", controls, review).state).toBe("actionable");
    expect(classifySecurityLint(tableLint, "free", controls, review).state).toBe("actionable");
  });
  it.each([null, {}, { roles: [] }, { roles: fixture().roles, functions: {}, tables: [] }])(
    "fails closed on malformed metadata: %j",
    (controls) => {
      expect(classifySecurityLint(functionLint, "free", controls, review).state).toBe("actionable");
      expect(inspectSecurityControls(controls, review).errors.length).toBeGreaterThan(0);
    }
  );
  it("keeps unrelated findings and contradictory advisor roles actionable", () => {
    const controls = fixture();
    expect(
      classifySecurityLint({ ...functionLint, name: "new_finding" }, "free", controls, review).state
    ).toBe("actionable");
    expect(
      classifySecurityLint(
        {
          ...functionLint,
          detail: functionLint.detail?.replace("current_staff_role()", "unknown_function()"),
        },
        "free",
        controls,
        review
      ).state
    ).toBe("actionable");
    expect(
      classifySecurityLint(
        { ...functionLint, detail: functionLint.detail?.replace("`anon`", "`authenticated`") },
        "free",
        controls,
        review
      ).state
    ).toBe("actionable");
    expect(
      classifySecurityLint(
        { ...tableLint, detail: tableLint.detail?.replace("content_views", "unknown_table") },
        "free",
        controls,
        review
      ).state
    ).toBe("actionable");
  });
  it("preserves native password protection as a separate plan-blocked finding", () => {
    const lint = {
      name: "auth_leaked_password_protection",
      title: "Password protection",
      level: "WARN",
    };
    expect(classifySecurityLint(lint, "free", fixture(), review).state).toBe("plan-blocked");
    expect(classifySecurityLint(lint, "pro", fixture(), review).state).toBe("actionable");
  });
  it("discovers dependencies and effective column grants through PostgreSQL catalog functions", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        CREATE TABLE public.content_views(id integer, secret text); ALTER TABLE public.content_views ENABLE ROW LEVEL SECURITY;
        CREATE FUNCTION public.staff_role_of(p_user uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT NULL::text $$;
        CREATE FUNCTION public.current_staff_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.staff_role_of(NULL::uuid) $$;
        REVOKE EXECUTE ON FUNCTION public.staff_role_of(uuid) FROM PUBLIC;
        GRANT SELECT(secret) ON public.content_views TO anon;`);
      const first = await db.query<{ controls: SecurityControls }>(SECURITY_CONTROL_QUERY);
      expect(first.rows[0].controls.functions.map((fn) => fn.name)).toEqual([
        "current_staff_role",
        "staff_role_of",
      ]);
      expect(first.rows[0].controls.tables[0].anonAccess).toBe(true);
      expect(first.rows[0].controls.tables[0].authenticatedAccess).toBe(false);
      await db.exec(
        `CREATE FUNCTION public.staff_role_of(p_user text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;`
      );
      const second = await db.query<{ controls: SecurityControls }>(SECURITY_CONTROL_QUERY);
      expect(
        second.rows[0].controls.functions.filter((fn) => fn.name === "staff_role_of")
      ).toHaveLength(2);
    } finally {
      await db.close();
    }
  });
});
