#!/usr/bin/env node
// Check-change guard (.github/workflows/check-changes.yml). Reads a pull
// request's changed files through the GitHub API, works out whether it deletes
// tests, adds skip or only marks, changes the check configuration or adds
// dependencies (scripts/lib/check-changes.mjs), then sets one label
// (checks-changed or checks-clean) and writes one comment, which it rewrites
// on every push. The label is information for the reviewer; it blocks nothing.
//
// In CI it runs from main's copy of this file. It never runs, imports or checks
// out the pull request's code: file names and patches are only read as data.
//
//   PR_NUMBER=123 GITHUB_REPOSITORY=owner/repo GITHUB_TOKEN=... node scripts/check-changed-checks.mjs
//   git diff origin/main... | node scripts/check-changed-checks.mjs --diff -   (local, prints only)
//
// Environment (CI): GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, optional
// GITHUB_API_URL and BASE_PACKAGE_JSON (main's package.json, default
// ./package.json).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  LABEL_CHANGED,
  LABEL_CLEAN,
  MARKER,
  analyseChanges,
  filesFromGitDiff,
  renderComment,
  summarySentence,
  verdictLabel,
} from "./lib/check-changes.mjs";

const BOT_LOGIN = "github-actions[bot]";
// GitHub lists at most 3000 files for a pull request (30 pages of 100).
const MAX_FILE_PAGES = 30;
const MAX_COMMENT_PAGES = 50;

const LABELS = {
  [LABEL_CHANGED]: {
    color: "d93f0b",
    description: "This PR changes tests or checks (see the bot comment)",
  },
  [LABEL_CLEAN]: { color: "0e8a16", description: "This PR changes no tests or checks" },
};

function readBasePackageJson(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
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

async function ensureLabel(api, name) {
  const found = await api("GET", `/labels/${encodeURIComponent(name)}`, undefined, {
    allow: [404],
  });
  if (found.status !== 404) return;
  // 422: another run created it in the meantime.
  await api("POST", "/labels", { name, ...LABELS[name] }, { allow: [422] });
}

async function setVerdictLabel(api, number, label) {
  const other = label === LABEL_CHANGED ? LABEL_CLEAN : LABEL_CHANGED;
  await ensureLabel(api, label);
  await api("POST", `/issues/${number}/labels`, { labels: [label] });
  await api("DELETE", `/issues/${number}/labels/${encodeURIComponent(other)}`, undefined, {
    allow: [404],
  });
}

/** Runs the guard against one pull request. Returns the analysis and label. */
export async function run({ env, fetchImpl = fetch, log = console.log }) {
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
  const { data: pull } = await api("GET", `/pulls/${number}`);
  const files = await listFiles(api, number);
  const expected = Number(pull?.changed_files);
  const complete = !Number.isFinite(expected) || files.length >= expected;
  const result = analyseChanges(files, {
    basePackageJson: readBasePackageJson(env.BASE_PACKAGE_JSON || "package.json"),
    complete,
  });
  const label = verdictLabel(result);
  const body = renderComment(result, { headSha: pull?.head?.sha });

  await setVerdictLabel(api, number, label);
  const existing = await findOwnComment(api, number);
  if (existing) {
    await api("PATCH", `/issues/comments/${existing.id}`, { body });
  } else {
    await api("POST", `/issues/${number}/comments`, { body });
  }
  log(`${label}: ${summarySentence(result)}`);
  return { result, label, body };
}

function runLocal(source) {
  const text = readFileSync(source === "-" ? 0 : source, "utf8");
  const result = analyseChanges(filesFromGitDiff(text), {
    basePackageJson: readBasePackageJson(process.env.BASE_PACKAGE_JSON || "package.json"),
  });
  process.stdout.write(`Label: ${verdictLabel(result)}\n\n${renderComment(result)}`);
}

async function main(argv) {
  if (argv[0] === "--diff") {
    if (!argv[1]) throw new Error("Usage: check-changed-checks.mjs --diff <file|->");
    runLocal(argv[1]);
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
