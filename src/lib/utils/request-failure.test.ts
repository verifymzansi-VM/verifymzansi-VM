/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";
import {
  describeRequestFailure,
  logRequestFailure,
  logServerRequestError,
} from "./request-failure";
import {
  addReferenceTiming,
  isRequestReference,
  readRayId,
  requestReference,
} from "./request-reference";
import { createFoundationCallRecorder } from "@/lib/foundation/call-failures";
import { defaultFallbackCount, recordDefaultFallback } from "./fallback-events";

const RAY = "8f1a2b3c4d5e6f70-JNB";
// Synthetic personal details that must never reach a log line.
const EMAIL = "thando.dlamini@example.com";
const PHONE = "0821234567";
const ID_NUMBER = "8001015009087";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
const PERSONAL = [EMAIL, PHONE, ID_NUMBER, TOKEN, "Thando", "Dlamini", "secret-cookie"];

let lines: string[];
beforeEach(() => {
  lines = [];
  for (const level of ["error", "warn", "info", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
});
afterEach(() => vi.restoreAllMocks());

function expectNoPersonalData(text: string) {
  for (const value of PERSONAL) expect(text).not.toContain(value);
  expect(text).not.toContain("?");
}

describe("request references", () => {
  it("uses Cloudflare's Ray ID and refuses malformed values", () => {
    expect(readRayId(new Headers({ "cf-ray": RAY }))).toBe(RAY);
    expect(readRayId({ "cf-ray": [RAY] })).toBe(RAY);
    expect(readRayId(new Headers({ "cf-ray": `${RAY}<script>` }))).toBeNull();
    expect(readRayId(new Headers({ "cf-ray": EMAIL }))).toBeNull();
    expect(requestReference(new Headers({ "cf-ray": RAY }))).toBe(RAY);
  });

  it("makes a random reference of the same shape when there is no Ray ID", () => {
    const first = requestReference(new Headers());
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(isRequestReference(first)).toBe(true);
    expect(requestReference(new Headers())).not.toBe(first);
    expect(isRequestReference("not a reference")).toBe(false);
  });

  it("passes only a valid Ray ID to the browser as Server-Timing", () => {
    const response = new Response(null);
    addReferenceTiming({ headers: new Headers({ "cf-ray": RAY }) }, response);
    expect(response.headers.get("Server-Timing")).toBe(`cfray;desc="${RAY}"`);
    const untouched = new Response(null);
    addReferenceTiming({ headers: new Headers({ "cf-ray": '"; x' }) }, untouched);
    expect(untouched.headers.has("Server-Timing")).toBe(false);
  });
});

describe("failure log lines", () => {
  it("logs one line with type, command, database code and reference, and returns it", async () => {
    const recorder = createFoundationCallRecorder(async () =>
      Response.json(
        { code: "42501", message: `permission denied for ${EMAIL}`, details: PHONE },
        { status: 403 }
      )
    );
    const api = recorder.attach({});
    await recorder.fetch("https://project.supabase.co/rest/v1/rpc/save_my_profile?select=*", {
      method: "POST",
      body: JSON.stringify({ p_display_name: "Thando Dlamini", p_id_number: ID_NUMBER }),
    });
    class FoundationProfileError extends Error {
      readonly reason = "unavailable";
    }
    const reference = logRequestFailure(createLogger("Test"), "Foundation owner request failed", {
      request: {
        headers: new Headers({ "cf-ray": RAY, cookie: "sb=secret-cookie", "x-email": EMAIL }),
      },
      error: new FoundationProfileError(`Profile for ${EMAIL} ${PHONE} failed`),
      api,
      action: "profile:update",
    });
    expect(reference).toBe(RAY);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const part of [
      "Foundation owner request failed",
      '"event":"request_failed"',
      `"reference":"${RAY}"`,
      '"action":"profile:update"',
      '"errorType":"FoundationProfileError"',
      '"errorReason":"unavailable"',
      '"command":"save_my_profile"',
      '"errorCode":"42501"',
      '"httpStatus":403',
    ])
      expect(line).toContain(part);
    expectNoPersonalData(line);
  });

  it("records lost requests and keeps the latest failure across clients", async () => {
    const first = createFoundationCallRecorder(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const second = createFoundationCallRecorder(async () =>
      Response.json({ code: "PT409" }, { status: 409 })
    );
    const apis = [first.attach({}), second.attach({})];
    await second.fetch("https://project.supabase.co/rest/v1/rpc/claim_upload");
    await expect(
      first.fetch("https://project.supabase.co/rest/v1/rpc/finish_upload")
    ).rejects.toThrow();
    expect(describeRequestFailure(new Error("x"), apis)).toEqual({
      errorType: "Error",
      command: "finish_upload",
      callErrorType: "TimeoutError",
    });
    await second.fetch("https://project.supabase.co/auth/v1/user");
    expect(describeRequestFailure(null, apis)).toEqual({
      errorType: "null",
      command: "auth",
      errorCode: "PT409",
      httpStatus: 409,
    });
  });

  it("drops error codes and reasons that could hold personal data", () => {
    expect(describeRequestFailure({ code: PHONE, reason: EMAIL })).toEqual({
      errorType: "object",
    });
    expect(describeRequestFailure({ code: "PGRST202", reason: `id_${ID_NUMBER}` })).toEqual({
      errorType: "object",
      errorCode: "PGRST202",
    });
    expect(describeRequestFailure("plain text")).toEqual({ errorType: "string" });
  });

  it("logs server render errors with digest and route file, never the visited path", () => {
    const error = Object.assign(new TypeError(`Cannot read ${EMAIL}`), { digest: "2817364519" });
    logServerRequestError(
      error,
      {
        method: "GET",
        headers: { "cf-ray": RAY, cookie: "sb=secret-cookie" },
      },
      { routePath: "/listing/[id]", routeType: "render" }
    );
    expect(lines).toHaveLength(1);
    const [line] = lines;
    for (const part of [
      '"reference":"8f1a2b3c4d5e6f70-JNB"',
      '"digest":"2817364519"',
      '"routePath":"/listing/[id]"',
      '"routeType":"render"',
      '"errorType":"TypeError"',
      '"method":"GET"',
    ])
      expect(line).toContain(part);
    expectNoPersonalData(line);
  });

  it("ignores unexpected route and method values", () => {
    logServerRequestError(
      new Error("x"),
      { method: "BREW", headers: {} },
      { routePath: `/search?q=${EMAIL}`, routeType: "other" }
    );
    expect(lines[0]).not.toContain("routePath");
    expect(lines[0]).not.toContain("BREW");
    expectNoPersonalData(lines[0]);
  });
});

describe("default-value fallbacks", () => {
  it("logs a counted warning each time", () => {
    const before = defaultFallbackCount("commercial_settings");
    const log = createLogger("Test");
    recordDefaultFallback(log, "commercial_settings", { errorCode: "42P01" });
    recordDefaultFallback(log, "commercial_settings", { usedCachedValue: true });
    expect(defaultFallbackCount("commercial_settings")).toBe(before + 2);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"event":"fallback_to_default"');
    expect(lines[0]).toContain('"fallback":"commercial_settings"');
    expect(lines[0]).toContain(`"count":${before + 1}`);
    expect(lines[0]).toContain('"errorCode":"42P01"');
    expect(lines[1]).toContain(`"count":${before + 2}`);
    expect(lines[1]).toContain('"usedCachedValue":true');
  });
});
