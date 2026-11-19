#!/usr/bin/env node
// Check-change guard (.github/workflows/check-changes.yml). Reads a pull
// request's changed files through the GitHub API, works out whether it deletes
// tests, adds skip or only marks, changes the check configuration or changes
// dependencies (scripts/lib/check-changes.mjs), then sets one label
// (checks-changed or checks-clean) and writes one comment, which it rewrites
// on every push. The label is information for the reviewer; it blocks nothing.
//
// It fails closed: the label is set to checks-changed before anything is
// analysed and moves to checks-clean only after a clean verdict's comment is
// written. On any error or time-out the comment says the pull request could
// not be checked and must be treated as changing checks.
//
// In CI it runs from main's copy of this file. It never runs, imports or checks
// out the pull request's code: file names, patches and the two package.json
// files (fetched through the contents API) are only read as data.
//
//   PR_NUMBER=123 GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/check-changed-checks.mjs
//   PR_NUMBER=123 ... node scripts/check-changed-checks.mjs --could-not-check
//   git diff "$(git merge-base origin/main HEAD)" | node scripts/check-changed-checks.mjs --diff -
//     (local, prints only; see "Test and check changes label" in docs/branch-protection.md)
//
// Environment (CI): GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, optional
// GITHUB_API_URL and BASE_DIR (main's checkout, holding package.json,
// vitest.config.ts, the Playwright configs, the workflows and the scripts;
// default the working directory). Local --diff runs also read
// BASE_PACKAGE_JSON (the merge base's package.json) and HEAD_PACKAGE_JSON
// (default ./package.json) when the diff changes package.json.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LABEL_CHANGED,
  LABEL_CLEAN,
  MARKER,
  analyseChanges,
  buildCheckCommands,
  buildTestSuites,
  filesFromGitDiff,
  renderComment,
  renderFailureComment,
  summarySentence,
  verdictLabel,
} from "./lib/check-changes.mjs";

const BOT_LOGIN = "github-actions[bot]";
// GitHub lists at most 3000 files for a pull request (30 pages of 100).
const MAX_FILE_PAGES = 30;
const MAX_COMMENT_PAGES = 50;
// Each API call, and the whole analysis, have a time limit well inside the
// workflow step's, so a slow run still ends with the could-not-check comment.
const REQUEST_TIMEOUT_MS = 30_000;
const ANALYSIS_DEADLINE_MS = 150_000;
const SHA = /^[0-9a-f]{40}$/;

const LABELS = {
  [LABEL_CHANGED]: {
    color: "d93f0b",
    description: "This PR changes tests or checks (see the bot comment)",
  },
  [LABEL_CLEAN]: { color: "0e8a16", description: "This PR changes no tests or checks" },
};

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Main's test configuration, read as text from its checkout. */
export function readBaseSuites(baseDir, extraPackageJsons = []) {
  let names = [];
  try {
    names = readdirSync(baseDir).filter((name) =>
      /^playwright(?:\.[^/]+)?\.config\.[cm]?[jt]s$/.test(name)
    );
  } catch {
    names = [];
  }
  const playwrightConfigs = {};
  for (const name of names) {
    const text = readText(path.join(baseDir, name));
    if (text !== undefined) playwrightConfigs[name] = text;
  }
  return buildTestSuites({
    vitestConfig: readText(path.join(baseDir, "vitest.config.ts")),
    playwrightConfigs,
    packageJsons: [readText(path.join(baseDir, "package.json")), ...extraPackageJsons],
  });
}

/**
 * The commands main's workflows run and the files they execute, read as text
 * from main's checkout (its .github/workflows, package.json and scripts).
 */
export function readBaseChecks(baseDir, extraPackageJsons = []) {
  const workflowDir = path.join(baseDir, ".github", "workflows");
  const workflows = {};
  let names = [];
  try {
    names = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
  } catch {
    names = [];
  }
  for (const name of names) {
    const text = readText(path.join(workflowDir, name));
    if (text !== undefined) workflows[name] = text;
  }
  const root = path.resolve(baseDir);
  return buildCheckCommands({
    workflows,
    packageJsons: [readText(path.join(baseDir, "package.json")), ...extraPackageJsons],
    // Only files inside main's checkout, by repository path.
    readFile: (file) => {
      const resolved = path.resolve(root, file);
      if (!resolved.startsWith(root + path.sep)) return undefined;
      return readText(resolved);
    },
  });
}

export function createApi({ token, apiUrl, repository, fetchImpl = fetch }) {
  const base = `${apiUrl.replace(/\/$/, "")}/repos/${repository}`;
  return async function api(method, path, body, { allow = [] } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "check-change-guard",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (allow.includes(response.status)) return { status: response.status, data: null };
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `GitHub API ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`
      );
    }
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  };
}

async function listFiles(api, number) {
  const files = [];
  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const { data } = await api("GET", `/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error("The pull request file list was not a list.");
    files.push(...data);
    if (data.length < 100) break;
  }
  return files;
}

// package.json at one commit, as text; null when it does not exist there.
async function packageJsonAt(api, sha) {
  const { status, data } = await api("GET", `/contents/package.json?ref=${sha}`, undefined, {
    allow: [404],
  });
  if (status === 404) return null;
  if (data?.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("package.json could not be read through the contents API.");
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}

// The merge base's and the head's package.json, compared as data. They are
// never written to disk or mapped onto main's copy.
async function fetchPackages(api, pull) {
  const baseSha = pull?.base?.sha;
  const headSha = pull?.head?.sha;
  if (!SHA.test(String(baseSha)) || !SHA.test(String(headSha))) {
    throw new Error("The pull request has no valid base or head commit.");
  }
  const { data: comparison } = await api("GET", `/compare/${baseSha}...${headSha}?per_page=1`);
  const mergeBase = comparison?.merge_base_commit?.sha;
  if (!SHA.test(String(mergeBase))) throw new Error("GitHub gave no merge base.");
  return { base: await packageJsonAt(api, mergeBase), head: await packageJsonAt(api, headSha) };
}

async function findOwnComment(api, number) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const { data } = await api("GET", `/issues/${number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error("The comment list was not a list.");
    // Only this workflow's own comment counts: anyone can post the marker.
    const own = data.find(
      (comment) =>
        comment?.user?.login === BOT_LOGIN &&
        comment?.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.startsWith(MARKER)
    );
    if (own) return own;
    if (data.length < 100) break;
  }
  return null;
}

async function writeComment(api, number, body) {
  const existing = await findOwnComment(api, number);
  if (existing) {
    await api("PATCH", `/issues/comments/${existing.id}`, { body });
  } else {
    await api("POST", `/issues/${number}/comments`, { body });
  }
}

async function ensureLabel(api, name) {
  const found = await api("GET", `/labels/${encodeURIComponent(name)}`, undefined, {
    allow: [404],
  });
  const wanted = LABELS[name];
  if (found.status === 404) {
    // 422: another run created it in the meantime.
    await api("POST", "/labels", { name, ...wanted }, { allow: [422] });
    return;
  }
  // The workflow's first step adds the label before this script runs; on a
  // first run GitHub creates it plain, so give it its colour and description.
  const label = found.data ?? {};
  if (
    String(label.color ?? "").toLowerCase() !== wanted.color ||
    (label.description ?? "") !== wanted.description
  ) {
    await api("PATCH", `/labels/${encodeURIComponent(name)}`, wanted, { allow: [404] });
  }
}

async function setVerdictLabel(api, number, label) {
  const other = label === LABEL_CHANGED ? LABEL_CLEAN : LABEL_CHANGED;
  await ensureLabel(api, label);
  await api("POST", `/issues/${number}/labels`, { labels: [label] });
  await api("DELETE", `/issues/${number}/labels/${encodeURIComponent(other)}`, undefined, {
    allow: [404],
  });
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`The check did not finish within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function connect(env, fetchImpl) {
  const token = env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY ?? "";
  const number = env.PR_NUMBER ?? "";
  if (!token) throw new Error("GITHUB_TOKEN is not set.");
  if (!/^[A-Za-z0-9-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must look like owner/repo.");
  }
  if (!/^[1-9]\d{0,9}$/.test(number)) throw new Error("PR_NUMBER must be a pull request number.");
  const api = createApi({
    token,
    apiUrl: env.GITHUB_API_URL || "https://api.github.com",
    repository,
    fetchImpl,
  });
  return { api, number };
}

async function analysePullRequest(api, number, baseDir) {
  const { data: before } = await api("GET", `/pulls/${number}`);
  const files = await listFiles(api, number);
  // The head is read again after the file list, so the verdict names the
  // commit the list belongs to; a push in between means the list may be mixed.
  const { data: pull } = await api("GET", `/pulls/${number}`);
  if (before?.head?.sha !== pull?.head?.sha) {
    throw new Error("The pull request changed while it was being checked.");
  }
  const expected = Number(pull?.changed_files);
  const complete = Number.isFinite(expected) && files.length >= expected;
  const touchesPackage = files.some(
    (file) => file?.filename === "package.json" || file?.previous_filename === "package.json"
  );
  const packages = touchesPackage ? await fetchPackages(api, pull) : undefined;
  const extra = packages?.head ? [packages.head] : [];
  const suites = readBaseSuites(baseDir, extra);
  const checks = readBaseChecks(baseDir, extra);
  const result = analyseChanges(files, { complete, packages, suites, checks });
  return { result, headSha: pull?.head?.sha };
}

/** Labels the pull request checks-changed and writes the could-not-check comment. */
export async function markCouldNotCheck({ env, fetchImpl = fetch }) {
  const { api, number } = connect(env, fetchImpl);
  await setVerdictLabel(api, number, LABEL_CHANGED);
  await writeComment(api, number, renderFailureComment());
}

/** Runs the guard against one pull request. Returns the analysis and label. */
export async function run({
  env,
  fetchImpl = fetch,
  log = console.log,
  deadlineMs = ANALYSIS_DEADLINE_MS,
}) {
  const { api, number } = connect(env, fetchImpl);
  // Fail closed: until a verdict is written, the pull request counts as
  // changing checks.
  await setVerdictLabel(api, number, LABEL_CHANGED);

  let analysis;
  try {
    analysis = await withDeadline(analysePullRequest(api, number, env.BASE_DIR || "."), deadlineMs);
  } catch (error) {
    await writeComment(api, number, renderFailureComment()).catch(() => {});
    throw error;
  }
  const { result, headSha } = analysis;
  const label = verdictLabel(result);
  const body = renderComment(result, { headSha });
  await writeComment(api, number, body);
  if (label === LABEL_CLEAN) await setVerdictLabel(api, number, LABEL_CLEAN);
  log(`${label}: ${summarySentence(result)}`);
  return { result, label, body };
}

function runLocal(source) {
  const text = readFileSync(source === "-" ? 0 : source, "utf8");
  const files = filesFromGitDiff(text);
  const base = process.env.BASE_PACKAGE_JSON;
  const head = process.env.HEAD_PACKAGE_JSON || "package.json";
  const packages = base
    ? { base: readText(base) ?? null, head: readText(head) ?? null }
    : undefined;
  const extra = packages?.head ? [packages.head] : [];
  const result = analyseChanges(files, {
    packages,
    suites: readBaseSuites(".", extra),
    checks: readBaseChecks(".", extra),
  });
  process.stdout.write(`Label: ${verdictLabel(result)}\n\n${renderComment(result)}`);
}

async function main(argv) {
  if (argv[0] === "--diff") {
    if (!argv[1]) throw new Error("Usage: check-changed-checks.mjs --diff <file|->");
    runLocal(argv[1]);
    return;
  }
  if (argv[0] === "--could-not-check" && argv.length === 1) {
    await markCouldNotCheck({ env: process.env });
    return;
  }
  if (argv.length > 0) throw new Error(`Unknown argument: ${argv.join(" ")}`);
  await run({ env: process.env });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `::error title=Check-change guard::${String(error?.message ?? error).replace(/[\r\n]+/g, " ")}`
    );
    process.exitCode = 1;
  });
}
