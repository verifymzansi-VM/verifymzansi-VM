// Read-only comparison of a hosted foundation database with the updates this
// commit expects ("database behind by N" / "ahead by N").
//
//   pnpm exec tsx scripts/check-foundation-update-drift.ts --target=staging
//   pnpm exec tsx scripts/check-foundation-update-drift.ts --target=production
//
// Only the publishable key is used: every runtime API command is called
// anonymously and must refuse (or, for the reviewed public projections, return
// an empty list); a missing command means its update has not been applied.
//
// staging: FOUNDATION_STAGING_SUPABASE_URL, FOUNDATION_STAGING_PROJECT_REF and
// FOUNDATION_STAGING_SUPABASE_PUBLISHABLE_KEY. With none of them set it prints a
// notice and exits 0 (inert until the owner creates staging). Fails when staging
// is behind this commit, because updates reach staging before merge.
// production: FOUNDATION_SUPABASE_URL, FOUNDATION_PROJECT_REF and
// FOUNDATION_SUPABASE_PUBLISHABLE_KEY; warns only (the deploy preflight runs the
// same comparison).
import { parseFoundationConnection } from "../src/lib/foundation/connection";
import { printUpdateDrift, readFoundationUpdateDrift } from "./lib/foundation-update-order.mjs";

const PRODUCTION_REF = "gntzjtuncsyefujajmjy";

function settings(target: string, env: NodeJS.ProcessEnv) {
  const prefix = target === "staging" ? "FOUNDATION_STAGING_" : "FOUNDATION_";
  return {
    url: env[`${prefix}SUPABASE_URL`] ?? "",
    expectedProjectRef: env[`${prefix}PROJECT_REF`] ?? "",
    publishableKey: env[`${prefix}SUPABASE_PUBLISHABLE_KEY`] ?? "",
  };
}

/** Exported for tests: a synthetic fetcher replaces the network. */
export async function main(
  argv: string[] = process.argv.slice(2),
  options: { fetcher?: typeof fetch } = {}
) {
  const args = argv.filter((arg) => arg !== "--");
  const target = args.length === 1 ? /^--target=(staging|production)$/.exec(args[0])?.[1] : null;
  if (!target) throw new Error("Usage: --target=staging|production");
  const values = settings(target, process.env);
  const given = Object.values(values).filter(Boolean).length;
  if (target === "staging" && given === 0) {
    printUpdateDrift([
      {
        level: "notice",
        text: "Staging is not configured (FOUNDATION_STAGING_* unset): the staging database check is inert.",
      },
    ]);
    return 0;
  }
  if (given !== 3) throw new Error(`Incomplete ${target} connection settings`);
  const connection = parseFoundationConnection(values);
  if ((connection.expectedProjectRef === PRODUCTION_REF) !== (target === "production"))
    throw new Error(
      target === "staging"
        ? "Staging must not point at the production project"
        : "Production must be the approved London project"
    );
  let result: Awaited<ReturnType<typeof readFoundationUpdateDrift>>;
  try {
    result = await readFoundationUpdateDrift(connection, {
      target,
      recorded: target === "production",
      fetcher: options.fetcher,
    });
  } catch {
    // Network failure, timeout or a paused project: nothing was measured.
    printUpdateDrift([
      {
        level: "warning",
        text: `${target} database could not be reached: update order not compared (inconclusive).`,
      },
    ]);
    return 0;
  }
  const { drift, lines } = result;
  printUpdateDrift(lines);
  if (drift.unexpected.length > 0)
    printUpdateDrift([
      {
        level: "warning",
        text: `${target} comparison is inconclusive for commands that answered unexpectedly (paused project or gateway error); only commands PostgREST reports missing count as behind.`,
      },
    ]);
  if (target === "staging" && drift.behind.length > 0) {
    console.error("Staging is not in step with this commit: apply its updates to staging first.");
    return 1;
  }
  return 0;
}

if (process.argv[1] && /check-foundation-update-drift\.ts$/.test(process.argv[1]))
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // Never echo connection values or provider bodies.
      console.error(error instanceof Error ? error.message : "Update drift check failed");
      process.exitCode = 1;
    }
  );
