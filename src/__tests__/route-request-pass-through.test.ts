import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as postQueue } from "@/app/api/admin/queue/route";
import { POST as postVerificationDecision } from "@/app/api/admin/verification/decide/route";
import { POST as postContentDelete } from "@/app/api/content/delete/route";
import { POST as postInviteAccept } from "@/app/api/organisations/invites/accept/route";

/**
 * On Cloudflare (workerd) Next.js hands a route handler a JS Proxy around its
 * request. Building a new request from it (`new NextRequest(request)`) throws
 * "Invalid URL: [object Request]" before any error handling, so the route
 * answered a bare 500. Route handlers pass their request on unchanged.
 */

const APP_DIR = path.resolve(__dirname, "../app");
const WRAPPING = /new\s+(?:Next)?Request\s*\(\s*(?:request|req)\b/;

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js)$/.test(entry.name) ? [full] : [];
  });
}

describe("route handlers pass their request on unchanged", () => {
  it("no route builds a new request from the incoming one", () => {
    const files = routeFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter((file) => WRAPPING.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(APP_DIR, file).replaceAll("\\", "/"));
    expect(offenders).toEqual([]);
  });

  it.each([
    ["/api/admin/queue", postQueue],
    ["/api/admin/verification/decide", postVerificationDecision],
    ["/api/content/delete", postContentDelete],
    ["/api/organisations/invites/accept", postInviteAccept],
  ])("%s answers a proxied request (as on Cloudflare) without crashing", async (route, post) => {
    const request = new NextRequest(`http://localhost:3000${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: "{}",
    });
    const proxied = new Proxy(request, {
      get: (target, property) => Reflect.get(target, property, target),
    });
    const response = await post(proxied);
    // Refused by the route's own checks (cross-site request), not a crash.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
