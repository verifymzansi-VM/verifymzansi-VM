import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { execute, pnpmInvocation } from "./lib/audit-runtime";
import { parseSupabaseStatus } from "./lib/supabase-status";
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
      name === "status" || name === "start"
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
    const status = parseSupabaseStatus(statusOutput);
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
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('confirm_ozow_payment','claim_ozow_reconciliation','apply_kyc_provider_webhook','finalize_otp_phone_verification') AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE');`
    );
    if (grants !== "4") throw new Error(`Final RPC grants invalid: ${grants}`);
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

    const governors = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const created = await admin.auth.admin.createUser({
          email: `${randomUUID()}@example.invalid`,
          email_confirm: true,
        });
        if (created.error || !created.data.user)
          throw new Error("Synthetic governor could not be created");
        return created.data.user.id;
      })
    );
    await sql(
      `INSERT INTO public.staff_roles(user_id,role,status) VALUES ${governors.map((id) => `('${id}','governance_controller','active')`).join(",")};`
    );
    const overrideStep = randomUUID();
    await sql(
      `INSERT INTO public.verification_steps(id,user_id,step_type,status,risk_score,risk_level) VALUES ('${overrideStep}','${user}','selfie','pending',80,'high');`
    );
    const { data: versionedStep, error: versionedStepError } = await admin
      .from("verification_steps")
      .select("updated_at")
      .eq("id", overrideStep)
      .single();
    if (versionedStepError || !versionedStep?.updated_at)
      throw new Error("Synthetic step version missing");
    const proposalArgs = {
      p_actor: governors[0],
      p_step: overrideStep,
      p_user: user,
      p_risk_level: "high",
      p_override_reason: "verified_in_person",
      p_note: "Synthetic original evidence reviewed",
      p_expected_updated_at: versionedStep.updated_at,
    };
    const legacyArgs = {
      p_actor: governors[0],
      p_step: overrideStep,
      p_user: user,
      p_risk_level: "high",
      p_override_reason: "verified_in_person",
      p_note: "Synthetic legacy call",
    };
    const legacyProposal = await admin.rpc("propose_kyc_override", legacyArgs);
    if (legacyProposal.error || legacyProposal.data?.error !== "step_changed")
      throw new Error("Unversioned override did not fail closed");
    const microsecondOlder = await sql(
      `SELECT (updated_at - interval '1 microsecond')::text FROM public.verification_steps WHERE id='${overrideStep}';`
    );
    const staleProposal = await admin.rpc("propose_kyc_override", {
      ...proposalArgs,
      p_expected_updated_at: microsecondOlder,
    });
    if (staleProposal.error || staleProposal.data?.error !== "step_changed")
      throw new Error("Override proposal rounded away microsecond drift");
    const competingProposals = await Promise.all(
      governors.slice(0, 2).map((actor) =>
        createClient(status.API_URL, status.SERVICE_ROLE_KEY).rpc("propose_kyc_override", {
          ...proposalArgs,
          p_actor: actor,
        })
      )
    );
    if (
      competingProposals.some((result) => result.error) ||
      competingProposals.filter((result) => result.data?.ok === true).length !== 1 ||
      competingProposals.filter((result) => result.data?.error === "pending_exists").length !== 1
    )
      throw new Error("Concurrent KYC proposals were not serialized");
    const winner = competingProposals.find((result) => result.data?.ok === true)!.data.decision_id;
    const { data: pendingDecision, error: pendingDecisionError } = await admin
      .from("decision_records")
      .select("recommender_id")
      .eq("id", winner)
      .single();
    if (pendingDecisionError || !pendingDecision) throw new Error("Winning proposal missing");
    const approvalArgs = {
      p_actor: governors[2],
      p_decision: winner,
      p_payload_version: 1,
      p_note: "Synthetic independent review",
    };
    const selfApproval = await admin.rpc("approve_decision", {
      ...approvalArgs,
      p_actor: pendingDecision.recommender_id,
    });
    if (selfApproval.error || selfApproval.data?.error !== "not_independent")
      throw new Error("Proposer approved their own override");
    const changedPayload = await admin.rpc("approve_decision", {
      ...approvalArgs,
      p_payload_version: 2,
    });
    if (changedPayload.error || changedPayload.data?.error !== "payload_changed")
      throw new Error("Changed override payload was accepted");
    const competingApprovals = await Promise.all(
      governors.slice(2).map((actor) =>
        createClient(status.API_URL, status.SERVICE_ROLE_KEY).rpc("approve_decision", {
          ...approvalArgs,
          p_actor: actor,
        })
      )
    );
    if (
      competingApprovals.some((result) => result.error) ||
      competingApprovals.filter((result) => result.data?.ok === true).length !== 1 ||
      competingApprovals.filter((result) => result.data?.error === "not_pending").length !== 1
    )
      throw new Error("Concurrent KYC approvals were not serialized");
    if (
      (await sql(
        `SELECT count(*) FROM public.decision_approvals WHERE decision_id='${winner}';`
      )) !== "1"
    )
      throw new Error("Duplicate KYC approval was recorded");
    const nextProposal = await admin.rpc("propose_kyc_override", proposalArgs);
    if (nextProposal.error || !nextProposal.data?.ok)
      throw new Error("Replacement fixture proposal failed");
    await sql(`UPDATE public.verification_steps SET risk_score=81 WHERE id='${overrideStep}';`);
    const replacementApproval = await admin.rpc("approve_decision", {
      ...approvalArgs,
      p_decision: nextProposal.data.decision_id,
    });
    if (replacementApproval.error || replacementApproval.data?.error !== "step_changed")
      throw new Error("Replacement evidence inherited an old approval");
    const privateProposalGrant = await sql(
      `SELECT has_function_privilege('service_role','public.propose_kyc_override(uuid,uuid,uuid,text,text,text,timestamp with time zone)','EXECUTE') AND NOT has_function_privilege('anon','public.propose_kyc_override(uuid,uuid,uuid,text,text,text,timestamp with time zone)','EXECUTE') AND NOT has_function_privilege('authenticated','public.propose_kyc_override(uuid,uuid,uuid,text,text,text,timestamp with time zone)','EXECUTE');`
    );
    if (privateProposalGrant !== "t")
      throw new Error("Versioned KYC proposal grants are not service-only");
    results.push({
      name: "Versioned KYC overrides and independent-session proposal/approval races",
      status: "PASS",
    });
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
