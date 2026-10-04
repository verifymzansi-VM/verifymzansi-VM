import { spawnSync } from "node:child_process";
import { execute } from "./lib/audit-runtime";
import { domainTestCommand } from "./lib/domain-test-command";
const domain = process.argv[2];
async function main() {
  if (!["payments", "kyc"].includes(domain) || process.argv.length !== 3)
    throw new Error("Usage: run-domain-tests.ts <payments|kyc>");
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src"],
    { encoding: "utf8", timeout: 30_000 }
  );
  if (result.status !== 0) throw new Error("Cannot enumerate domain regression tests");
  const files = result.stdout
    .split("\0")
    .filter(
      (file) =>
        /\.(test|spec)\.(ts|tsx)$/.test(file) &&
        (domain === "payments"
          ? /payments|billing|ozow|invoice|entitlement|pricing|checkout|addon|payment|boost|featured|urgent|commercial|plan-change|subscription/i
          : /kyc|verification|encryption|crypto|fraud|retention|evidence|reviewer|decision|governance-decide/i
        ).test(file)
    );
  if (!files.length) throw new Error("No domain tests found");
  process.stdout.write(`${domain}: ${files.length} test files selected\n`);
  const [command, args] = domainTestCommand(files);
  const run = await execute(command, args, 600_000);
  process.stdout.write(run.output);
  if (run.status !== "PASS") process.exitCode = run.status === "UNAVAILABLE" ? 2 : 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
