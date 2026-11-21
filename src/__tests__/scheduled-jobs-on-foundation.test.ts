/** @vitest-environment node */
// Launch checklist item 8: the sponsorship, partner commission and retention
// jobs run on the live (foundation) backend, the London project, never on the
// retired backend. The chain, checked link by link from the code:
//
//   timed Worker (wrangler.*.toml cron, service binding APP -> verifymzansi)
//   -> website route (/api/webhooks/ops-jobs, /api/internal/retention/run)
//   -> src/lib/foundation job (runFoundationOperationJobs, runFoundationRetention)
//   -> createFoundationServiceApi (FOUNDATION_* bindings only)
//   -> POST https://<FOUNDATION_PROJECT_REF>.supabase.co/rest/v1/rpc/<command>
//      with the `api` schema profile.
//
// Production's FOUNDATION_PROJECT_REF in wrangler.toml is the only hosted
// project a production runtime accepts (approvedHostedProjectRef). Each of
// these commands also records its run on that database
// (20261120163500_staff_operations_health.sql), which the staff operations
// page shows, so the live database itself evidences the runs once deployed.
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { describe, expect, it, vi } from "vitest";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { approvedHostedProjectRef } from "@/lib/foundation/hosted-projects";

vi.mock("server-only", () => ({}));

const read = (path: string) => readFileSync(path, "utf8");
const toml = (path: string) => parse(read(path)) as Record<string, unknown>;
const LEGACY_CLIENT =
  /@\/lib\/supabase\/(admin|server|client)|lib\/supabase\/(admin|server|client)/;

type Production = { vars: Record<string, string> };
const production = (toml("wrangler.toml").env as Record<string, Production>).production.vars;
const LONDON = production.FOUNDATION_PROJECT_REF;

describe("the timed Workers start the website's foundation jobs", () => {
  for (const [config, worker, route, schedule] of [
    ["wrangler.ops-jobs.toml", "workers/ops-jobs.ts", "/api/webhooks/ops-jobs", "* * * * *"],
    [
      "wrangler.retention-cleanup.toml",
      "workers/retention-cleanup.ts",
      "/api/internal/retention/run",
      "*/5 * * * *",
    ],
  ] as const)
    it(`${config}: ${schedule}, through the production website, to ${route}`, () => {
      const settings = toml(config) as {
        triggers: { crons: string[] };
        services?: { binding: string; service: string }[];
        vars: Record<string, string>;
      };
      expect(settings.triggers.crons).toContain(schedule);
      expect(settings.vars.ENVIRONMENT).toBe("production");
      expect(settings.services ?? []).toContainEqual({ binding: "APP", service: "verifymzansi" });
      const source = read(worker);
      expect(source).toContain(`"${route}"`);
      expect(source).not.toMatch(LEGACY_CLIENT);
    });
});

describe("the job code reaches only the foundation service client", () => {
  it("the minute job runs the sponsorship and commission sweeps through it", () => {
    const route = read("src/app/api/webhooks/ops-jobs/route.ts");
    expect(route).toContain("runFoundationOperationJobs");
    const jobs = read("src/lib/foundation/operation-jobs.ts");
    expect(jobs).toMatch(/\["sweep_sponsorships", \{ p_limit: \d+ \}\]/);
    expect(jobs).toMatch(/\["approve_due_commissions", \{ p_limit: \d+ \}\]/);
    expect(jobs).toContain("service: FoundationServiceApi = createFoundationServiceApi()");
    for (const source of [route, jobs]) expect(source).not.toMatch(LEGACY_CLIENT);
  });

  it("the 5-minute job runs the retention sweep through it", () => {
    const route = read("src/app/api/internal/retention/run/route.ts");
    expect(route).toContain("runFoundationRetention");
    const jobs = read("src/lib/foundation/retention-jobs.ts");
    expect(jobs).toContain('service.rpc("run_retention", { p_limit: 100 })');
    expect(jobs).toContain("service: FoundationServiceApi = createFoundationServiceApi()");
    for (const source of [route, jobs]) expect(source).not.toMatch(LEGACY_CLIENT);
  });

  it("the service client reads only the FOUNDATION_* bindings", () => {
    const source = read("src/lib/foundation/service-api.ts");
    expect(source).toContain("readFoundationRuntimeConnection(environment)");
    expect(source).toContain("environment.FOUNDATION_SUPABASE_SECRET_KEY");
    expect(source).not.toMatch(LEGACY_CLIENT);
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("production's foundation project is the London project", () => {
  it("wrangler.toml production binds the one approved project", () => {
    expect(LONDON).toBe(approvedHostedProjectRef("production"));
    expect(production.FOUNDATION_SUPABASE_URL).toBe(`https://${LONDON}.supabase.co`);
    expect(production.ENVIRONMENT).toBe("production");
  });

  it("each job command goes to that project's api schema", async () => {
    const fetcher = vi.fn(async () => Response.json(0));
    const service = createFoundationServiceApi(
      {
        ENVIRONMENT: "production",
        FOUNDATION_SUPABASE_URL: production.FOUNDATION_SUPABASE_URL,
        FOUNDATION_PROJECT_REF: LONDON,
        FOUNDATION_SUPABASE_PUBLISHABLE_KEY: production.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
        FOUNDATION_SUPABASE_SECRET_KEY: "sb_secret_synthetic-test-value",
      } as unknown as NodeJS.ProcessEnv,
      fetcher as unknown as typeof fetch
    );
    const rpc = service.rpc as unknown as (name: string, args: unknown) => PromiseLike<unknown>;
    for (const command of ["sweep_sponsorships", "approve_due_commissions", "run_retention"]) {
      fetcher.mockClear();
      await rpc(command, { p_limit: 1 });
      const [url, init] = fetcher.mock.calls[0] as unknown as [string | URL, RequestInit];
      const target = new URL(String(url));
      expect(target.host).toBe(`${LONDON}.supabase.co`);
      expect(target.pathname).toBe(`/rest/v1/rpc/${command}`);
      expect(new Headers(init.headers).get("content-profile")).toBe("api");
    }
  });

  it("a production runtime refuses any other project", () => {
    expect(() =>
      createFoundationServiceApi({
        ENVIRONMENT: "production",
        FOUNDATION_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
        FOUNDATION_PROJECT_REF: "abcdefghijklmnopqrst",
        FOUNDATION_SUPABASE_PUBLISHABLE_KEY: production.FOUNDATION_SUPABASE_PUBLISHABLE_KEY,
        FOUNDATION_SUPABASE_SECRET_KEY: "sb_secret_synthetic-test-value",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow();
  });
});
