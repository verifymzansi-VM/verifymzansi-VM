import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
async function main() {
  if (process.argv.length > 2) throw new Error("test:db:isolated accepts no flags");
  const output = path.resolve("tmp/isolated-db");
  await mkdir(output, { recursive: true });
  const results: Array<{ name: string; status: string; evidence?: string; reason?: string }> = [];
  const docker = await execute("docker", ["info", "--format", "{{.ServerVersion}}"], 15_000);
  if (docker.status !== "PASS") {
    await writeFile(
      path.join(output, "latest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          assessment: "INCOMPLETE",
          results: [{ name: "Docker", status: "UNAVAILABLE", reason: docker.output }],
          migrationStateVerified: false,
        },
        null,
        2
      )
    );
    process.stderr.write(
      "Docker unavailable: isolated PostgreSQL/PostgREST verification INCOMPLETE\n"
    );
    process.exitCode = 2;
    return;
  }
  const workdir = await mkdtemp(path.join(output, "database-"));
  const project = `vm_audit_${randomUUID().slice(0, 8)}`;
  await mkdir(path.join(workdir, "supabase"));
  await cp("supabase/migrations", path.join(workdir, "supabase/migrations"), { recursive: true });
  // Dedicated local config with no remote references, production secrets or auth integrations.
  await writeFile(
    path.join(workdir, "supabase/config.toml"),
    `project_id = "${project}"\n[api]\nenabled = true\nport = 56421\nschemas = ["public", "graphql_public"]\nextra_search_path = ["public", "extensions"]\n[db]\nport = 56422\nshadow_port = 56420\nmajor_version = 17\n[db.seed]\nenabled = false\n[auth]\nenabled = true\nsite_url = "http://localhost:3197"\n[studio]\nenabled = false\n[inbucket]\nenabled = false\n[analytics]\nenabled = false\n`
  );
  const runPnpm = async (name: string, args: string[], timeout = 600_000) => {
    const [command, invocation] = pnpmInvocation(args);
    const result = await execute(command, invocation, timeout);
    const evidence = path.join(output, `${project}-${name}.log`);
    await writeFile(
      evidence,
      name === "status"
        ? `Status: ${result.status}; local credentials withheld from persisted evidence`
        : result.output
    );
    results.push({ name, status: result.status, evidence });
    if (result.status !== "PASS") throw new Error(`${name}: ${result.status}`);
    return result.output;
  };
  let passed = false;
  try {
    await runPnpm(
      "start",
      [
        "exec",
        "supabase",
        "start",
        "--workdir",
        workdir,
        "--exclude",
        "studio,postgres-meta,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,mailpit",
      ],
      900_000
    );
    await runPnpm(
      "migrations",
      ["exec", "supabase", "db", "reset", "--local", "--workdir", workdir, "--no-seed"],
      600_000
    );
    const statusOutput = await runPnpm("status", [
      "exec",
      "supabase",
      "status",
      "--workdir",
      workdir,
      "-o",
      "json",
    ]);
    const status = JSON.parse(statusOutput.slice(statusOutput.indexOf("{")));
    if (
      new URL(status.API_URL).hostname !== "127.0.0.1" &&
      new URL(status.API_URL).hostname !== "localhost"
    )
      throw new Error("Refusing non-local database target");
    const env = {
      ...process.env,
      DB_TEST_SUPABASE_URL: status.API_URL,
      DB_TEST_SUPABASE_ANON_KEY: status.ANON_KEY,
      DB_TEST_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
      DB_TEST_ALLOW_REMOTE: "false",
    };
    const [command, args] = pnpmInvocation(["test:db"]);
    const rls = await execute(command, args, 180_000, env);
    await writeFile(path.join(output, `${project}-rls.log`), rls.output);
    results.push({ name: "PostgREST RLS", status: rls.status });
    if (rls.status !== "PASS") throw new Error("PostgREST RLS failed");
    const sql = async (statement: string) => {
      const result = await execute(
        "docker",
        [
          "exec",
          `supabase_db_${project}`,
          "psql",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
          "-c",
          statement,
        ],
        30_000
      );
      if (result.status !== "PASS") throw new Error(result.output);
      return result.output.trim();
    };
    const grants = await sql(
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('confirm_ozow_payment','claim_ozow_reconciliation','apply_kyc_provider_webhook') AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE');`
    );
    if (grants !== "3") throw new Error(`Final RPC grants invalid: ${grants}`);
    const payment = randomUUID(),
      artifact = randomUUID(),
      resultId = randomUUID(),
      ref = randomUUID();
    const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const created = await admin.auth.admin.createUser({
      email: `${randomUUID()}@example.invalid`,
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw created.error || new Error("No test user returned");
    const user = created.data.user.id;
    await sql(
      `INSERT INTO public.payments(id,user_id,area,amount_cents,status,provider,provider_payment_id) VALUES ('${payment}','${user}','MZANSI_MARKET',3000,'pending','ozow','audit-request'); INSERT INTO public.verification_steps(user_id,step_type,status,risk_score) VALUES ('${user}','id_doc','pending',20); INSERT INTO public.kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes) VALUES ('${artifact}','${user}','id_doc','synthetic','image/jpeg',1); INSERT INTO public.verification_sessions(user_id,id_artifact_id) VALUES ('${user}','${artifact}'); INSERT INTO public.kyc_provider_results(id,user_id,artifact_id,provider_name,provider_status,provider_ref) VALUES ('${resultId}','${user}','${artifact}','manual','pending','${ref}');`
    );
    // Separate HTTP requests/connections compete for the same row lock.
    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        createClient(status.API_URL, status.SERVICE_ROLE_KEY).rpc("claim_ozow_reconciliation", {
          p_payment_id: payment,
        })
      )
    );
    if (claims.some((r) => r.error) || claims.filter((r) => r.data === true).length !== 1)
      throw new Error("Reconciliation independent-session race failed");
    const callbacks = await Promise.all(
      Array.from({ length: 4 }, () =>
        createClient(status.API_URL, status.SERVICE_ROLE_KEY).rpc("apply_kyc_provider_webhook", {
          p_provider_ref: ref,
          p_status: "rejected",
          p_scores: { liveness_score: null },
        })
      )
    );
    if (
      callbacks.some((r) => r.error) ||
      callbacks.filter((r) => r.data?.outcome === "applied").length !== 1 ||
      callbacks.filter((r) => r.data?.outcome === "duplicate").length !== 3
    )
      throw new Error("KYC independent-session race failed");
    const risk = await sql(
      `SELECT risk_score FROM public.verification_steps WHERE user_id='${user}' AND step_type='id_doc';`
    );
    if (risk !== "50") throw new Error("Duplicate callback amplified risk");
    const unauthorized = await createClient(status.API_URL, status.ANON_KEY).rpc(
      "apply_kyc_provider_webhook",
      { p_provider_ref: ref, p_status: "approved" }
    );
    if (!unauthorized.error) throw new Error("Anonymous callback RPC bypass");
    results.push({ name: "Final grants and independent-session races", status: "PASS" });
    passed = true;
  } catch (error) {
    results.push({ name: "Final-state verification", status: "FAIL", reason: String(error) });
  } finally {
    try {
      await runPnpm(
        "stop",
        ["exec", "supabase", "stop", "--workdir", workdir, "--no-backup"],
        120_000
      );
    } catch {
      passed = false;
    }
    await writeFile(
      path.join(output, "latest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          workdir,
          project,
          assessment: passed ? "PASS" : "FAIL",
          results,
          migrationStateVerified: passed,
          limitations: [
            "Payment fulfillment/cancellation race is separately tested in PGlite; expand real PostgreSQL race fixtures",
          ],
        },
        null,
        2
      )
    );
  }
  if (!passed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
