/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));

const RAY = "8f1a2b3c4d5e6f70-JNB";
const EMAIL = "thando.dlamini@example.com";
const connection = {
  url: "https://gntzjtuncsyefujajmjy.supabase.co",
  expectedProjectRef: "gntzjtuncsyefujajmjy",
  publishableKey: "sb_publishable_synthetic",
};
const csrf = "a".repeat(64);
const base64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url").replaceAll("=", "");
const accessToken = [
  base64url({ alg: "ES256" }),
  base64url({
    role: "authenticated",
    sub: "11111111-1111-4111-8111-111111111111",
    session_id: "22222222-2222-4222-8222-222222222222",
  }),
  "signature",
].join(".");

let lines: string[];
const database = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  for (const level of ["error", "warn", "info", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  vi.mocked(readFoundationRuntimeConnection).mockReturnValue(connection);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  const api = createFoundationAuthenticatedApi(connection, accessToken, database);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => api,
    respond: async (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
afterEach(() => vi.restoreAllMocks());

function saveProfile(headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("https://verifymzansi.com/api/foundation/profile?ref=" + EMAIL, {
      method: "POST",
      body: JSON.stringify({ expected_revision: 2, display_name: "Thando Dlamini" }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://verifymzansi.com",
        cookie: `vm_csrf=${csrf}`,
        "x-csrf-token": csrf,
        ...headers,
      },
    })
  );
}

it("a database refusal logs code, command and request number, and the reply shows it", async () => {
  database.mockResolvedValueOnce(
    Response.json(
      {
        code: "42501",
        message: `permission denied for ${EMAIL}`,
        details: "Thando Dlamini",
        hint: null,
      },
      { status: 403 }
    )
  );
  const response = await saveProfile({ "cf-ray": RAY });

  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toEqual({ error: expect.any(String), reason: "unavailable", reference: RAY });
  expect(database).toHaveBeenCalledTimes(1);

  const failures = lines.filter((line) => line.includes("request_failed"));
  expect(failures).toHaveLength(1);
  const [line] = failures;
  expect(line).toContain('"command":"save_my_profile"');
  expect(line).toContain('"errorCode":"42501"');
  expect(line).toContain(`"reference":"${RAY}"`);
  expect(line).toContain('"action":"profile:update"');
  expect(line).toContain('"errorType":"FoundationProfileError"');
  expect(line).not.toContain(EMAIL);
  expect(line).not.toContain("Thando");
  expect(line).not.toContain(csrf);
});

it("a lost database request is logged too, with a generated reference outside Cloudflare", async () => {
  database.mockRejectedValueOnce(new DOMException("The operation timed out", "TimeoutError"));
  const response = await saveProfile();

  expect(response.status).toBe(503);
  const { reference } = await response.json();
  expect(reference).toMatch(/^[0-9a-f]{16}$/);
  const [line] = lines.filter((entry) => entry.includes("request_failed"));
  expect(line).toContain(`"reference":"${reference}"`);
  expect(line).toContain('"command":"save_my_profile"');
  expect(line).toContain('"callErrorType":"TimeoutError"');
});

it("a known refusal keeps its answer and is not logged as a failure", async () => {
  database.mockResolvedValueOnce(
    Response.json({ code: "PT409", details: "profile_changed" }, { status: 409 })
  );
  const response = await saveProfile({ "cf-ray": RAY });
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty("reference");
  expect(lines.filter((line) => line.includes("request_failed"))).toHaveLength(0);
});

it("a missing binding answers with a reference and logs it", async () => {
  vi.mocked(createFoundationRouteContext).mockImplementationOnce(() => {
    throw new Error("Unapproved foundation runtime project");
  });
  const response = await saveProfile({ "cf-ray": RAY });
  expect(response.status).toBe(503);
  expect((await response.json()).reference).toBe(RAY);
  expect(lines.filter((line) => line.includes("Foundation binding unavailable"))).toHaveLength(1);
});
