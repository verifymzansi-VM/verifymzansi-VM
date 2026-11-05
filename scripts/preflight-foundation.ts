import { loadEnvConfig } from "@next/env";
import { FoundationReleasePending } from "./lib/foundation-deployment";
import { verifyFoundationRuntime } from "./lib/foundation-runtime-readiness";

loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length > 1 || (args.length === 1 && args[0] !== "--provisioned-runtime"))
    throw new Error("Unsupported foundation preflight argument");
  const runtimeOnly = args[0] === "--provisioned-runtime";
  await verifyFoundationRuntime(process.env, runtimeOnly);
  console.log(
    runtimeOnly
      ? "Provisioned London application runtime verified: SQL digest, public read, service API contract, runtime extension presence/anonymous refusal and schema isolation. No database migration was executed; authenticated DTOs and clean baseline acceptance remain separate."
      : "Foundation public read, service API contract and schema isolation verified; authenticated grants, provider and recovery acceptance remain separate checks."
  );
}
main().catch((error) => {
  if (error instanceof FoundationReleasePending) {
    console.error(
      "INCOMPLETE: foundation acceptance is still open. No legacy schema queries or deployment were attempted."
    );
    process.exitCode = 2;
  } else {
    console.error(
      "Foundation preflight failed: review approved connection, release artifact and API exposure. Credentials withheld."
    );
    process.exitCode = 1;
  }
});
