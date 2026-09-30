// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verifymzansi-preflight-"));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "workers"));
  fs.mkdirSync(path.join(root, "src"));
  fs.copyFileSync(
    path.resolve("scripts/preflight-cloudflare.js"),
    path.join(root, "scripts/preflight-cloudflare.js")
  );
  const classes = ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge", "RateLimiterDO"];
  const bindings = [
    "NEXT_CACHE_DO_QUEUE",
    "NEXT_TAG_CACHE_DO_SHARDED",
    "NEXT_CACHE_DO_PURGE",
    "RATE_LIMITER_DO",
  ];
  fs.writeFileSync(
    path.join(root, "wrangler.toml"),
    `main = "workers/open-next-entry.mjs"\n${classes
      .map((name, i) => `{ name = "${bindings[i]}", class_name = "${name}" }`)
      .join("\n")}`
  );
  fs.writeFileSync(
    path.join(root, "workers/open-next-entry.mjs"),
    `export { ${classes.join(", ")} };\nexport default worker;`
  );
  fs.writeFileSync(
    path.join(root, "next.config.js"),
    'module.exports = { serverExternalPackages: ["sharp"] };'
  );
  fs.writeFileSync(path.join(root, ".env.production.local"), "existing-production-override\n");
  return root;
}

function run(root: string, args: string[] = []) {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts/preflight-cloudflare.js"), ...args],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    }
  );
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("verifymzansi-preflight-")
    ) {
      throw new Error("Refusing to remove a directory outside the temporary preflight fixtures");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("Cloudflare build preflight source safety", () => {
  it("rejects conflicting entrypoints without deleting source or rewriting environment files", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/proxy.ts"), "user-proxy-behavior");
    fs.writeFileSync(path.join(root, "src/middleware.ts"), "user-middleware-behavior");
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Both src/proxy.ts and src/middleware.ts exist");
    expect(fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8")).toBe("user-proxy-behavior");
    expect(fs.readFileSync(path.join(root, "src/middleware.ts"), "utf8")).toBe(
      "user-middleware-behavior"
    );
    expect(fs.readFileSync(path.join(root, ".env.production.local"), "utf8")).toBe(
      "existing-production-override\n"
    );
  });

  it("requires review of a lone Node proxy instead of replacing it with generated middleware", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/proxy.ts"), "user-proxy-behavior");
    const result = run(root, ["--validate-only"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not officially supported by OpenNext");
    expect(fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8")).toBe("user-proxy-behavior");
    expect(fs.existsSync(path.join(root, "src/middleware.ts"))).toBe(false);
  });

  it("validates the Edge entrypoint without writing build files", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "src/middleware.ts"), "user-middleware-behavior");
    const result = run(root, ["--validate-only"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cloudflare config validation passed");
    expect(fs.readFileSync(path.join(root, ".env.production.local"), "utf8")).toBe(
      "existing-production-override\n"
    );
  });

  it.skipIf(process.platform !== "win32")(
    "rejects Windows builds before writing source or env files",
    () => {
      const root = fixture();
      const result = run(root);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Cloudflare build is not supported on native Windows");
      expect(fs.existsSync(path.join(root, "src/middleware.ts"))).toBe(false);
      expect(fs.readFileSync(path.join(root, ".env.production.local"), "utf8")).toBe(
        "existing-production-override\n"
      );
    }
  );
});
