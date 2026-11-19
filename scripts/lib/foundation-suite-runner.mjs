// Runs the foundation behaviour suites (scripts/test-foundation-*.mjs) side by
// side instead of one after another.
//
// Each suite is its own Node process and starts its own throwaway, network-less
// Postgres container under a random name (scripts/lib/foundation-sql-lint.mjs),
// so suites share no database, port or file: running several at once checks
// exactly what running them in turn checks. Every suite still runs, even after
// another fails, and the run fails when any suite fails.
//
// A suite's output is held back until it ends, then printed in one piece, so
// logs never interleave. On GitHub Actions a passing suite's log is folded into
// a group and a failing one is printed open with an error annotation.
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

/** Default number of suites at once: the runner's cores, at most 4. */
export function defaultJobs(cores = availableParallelism()) {
  return Math.max(1, Math.min(4, cores));
}

/**
 * Parses `[--jobs=N] suite.mjs ...`. Refuses an empty list, a repeated suite,
 * an unknown option and a job count that is not a whole number from 1 to 16.
 */
export function parseArgs(argv, { cores } = {}) {
  let jobs = defaultJobs(cores);
  const suites = [];
  for (const arg of argv) {
    const option = /^--jobs=(.*)$/.exec(arg);
    if (option) {
      if (!/^\d+$/.test(option[1]) || Number(option[1]) < 1 || Number(option[1]) > 16)
        throw new Error(`--jobs must be a whole number from 1 to 16, not "${option[1]}"`);
      jobs = Number(option[1]);
    } else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (suites.includes(arg)) throw new Error(`${arg} is listed twice`);
    else suites.push(arg);
  }
  if (suites.length === 0) throw new Error("No suites given");
  return { jobs, suites };
}

/** Starts one suite as `node --import tsx <suite>`, collecting its output. */
export function nodeSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, ["--import", "tsx", suite], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const done = (code, detail = "") =>
      resolve({
        suite,
        code,
        seconds: Math.round((Date.now() - started) / 1000),
        output: Buffer.concat(chunks).toString("utf8") + detail,
      });
    child.on("error", (error) => done(1, `\nCould not start ${suite}: ${error.message}\n`));
    child.on("close", (code, signal) =>
      done(code ?? 1, signal ? `\n${suite} was stopped by ${signal}\n` : "")
    );
  });
}

/**
 * Runs `suites` with at most `jobs` at once, in the order given. `run(suite)`
 * resolves to { suite, code, seconds, output }; `report(result)` is called as
 * each one ends. Resolves to every result, in the order the suites were given.
 */
export async function runSuites(suites, { jobs, run = nodeSuite, report = () => {} }) {
  const results = new Array(suites.length);
  let next = 0;
  const worker = async () => {
    while (next < suites.length) {
      const index = next++;
      let result;
      try {
        result = await run(suites[index]);
      } catch (error) {
        result = {
          suite: suites[index],
          code: 1,
          seconds: 0,
          output: `${error?.stack ?? error}\n`,
        };
      }
      results[index] = result;
      report(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker));
  return results;
}

/** Text printed for one finished suite. */
export function formatResult(result, { actions = false } = {}) {
  const passed = result.code === 0;
  const head = `${result.suite}: ${passed ? "passed" : `FAILED (exit ${result.code})`} in ${result.seconds} s`;
  const body =
    result.output.endsWith("\n") || result.output === "" ? result.output : `${result.output}\n`;
  if (!actions) return `===== ${head}\n${body}`;
  if (passed) return `::group::${head}\n${body}::endgroup::\n`;
  return `::error title=Foundation suite failed::${head}\n${body}`;
}

/** Closing summary: one line per suite, slowest first, then the verdict. */
export function summary(results, { jobs, seconds }) {
  const failed = results.filter((result) => result.code !== 0);
  const lines = [...results]
    .sort((a, b) => b.seconds - a.seconds)
    .map(
      (r) => `  ${r.code === 0 ? "pass" : "FAIL"} ${String(r.seconds).padStart(4)} s  ${r.suite}`
    );
  const verdict = failed.length
    ? `${failed.length} of ${results.length} foundation suites failed: ${failed.map((r) => r.suite).join(", ")}`
    : `All ${results.length} foundation suites passed`;
  return `\nFoundation suites, ${jobs} at a time, ${seconds} s in all:\n${lines.join("\n")}\n${verdict}.\n`;
}

export async function main(
  argv = process.argv.slice(2),
  { write = (text) => process.stdout.write(text), env = process.env } = {}
) {
  const { jobs, suites } = parseArgs(argv);
  const actions = env.GITHUB_ACTIONS === "true";
  const started = Date.now();
  write(`Running ${suites.length} foundation suites, ${jobs} at a time.\n`);
  const results = await runSuites(suites, {
    jobs,
    report: (result) => write(formatResult(result, { actions })),
  });
  write(summary(results, { jobs, seconds: Math.round((Date.now() - started) / 1000) }));
  return results.every((result) => result.code === 0) ? 0 : 1;
}
