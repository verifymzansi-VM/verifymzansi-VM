import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  type FoundationAccountContext,
  FoundationAccountContextError,
  readFoundationAccountContext,
} from "./account-context";
import { createFoundationRequestCaller, FoundationSessionError } from "./request-api";
import { checkFoundationPageAccess } from "./page-access";

vi.mock("server-only", () => ({}));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./request-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createFoundationRequestCaller: vi.fn(),
}));
vi.mock("./account-context", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationAccountContext: vi.fn(),
}));
const id = "00000000-0000-4000-8000-000000000001";
const base = {
  account_id: id,
  phone: "+27820000000",
  staff: null,
} as FoundationAccountContext;
const call = vi.mocked(createFoundationRequestCaller);
const read = vi.mocked(readFoundationAccountContext);
beforeEach(() => {
  vi.clearAllMocks();
  call.mockResolvedValue({ accountId: id, api: {} } as Awaited<
    ReturnType<typeof createFoundationRequestCaller>
  >);
  read.mockResolvedValue(base);
});
const request = (path: string, cookie?: string) =>
  new NextRequest("https://verifymzansi.com" + path, cookie ? { headers: { cookie } } : {});
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("cloudflare-cdn-cache-control")).toBe("no-store");
}
it("rejects an old-project cookie and preserves the intended page in a same-origin login redirect", async () => {
  call.mockRejectedValue(new FoundationSessionError(401));
  const response = await checkFoundationPageAccess(
    request("/dashboard?tab=posts", "sb-tnygdgormnofpgjknlhr-auth-token=source"),
    false
  );
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe("https://verifymzansi.com");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("returnUrl")).toBe("/dashboard?tab=posts");
  expect(read).not.toHaveBeenCalled();
  privateResponse(response);
});
it("leaves sign-in available when there is no London session", async () => {
  call.mockRejectedValue(new FoundationSessionError(401));
  expect(
    (await checkFoundationPageAccess(request("/login"), true)).headers.get("x-middleware-next")
  ).toBe("1");
});
it("forwards every refreshed chunk and deletion both downstream and to the browser", async () => {
  call.mockImplementation(async (_, cookies) => {
    await cookies.setAll(
      [
        {
          name: "sb-gntzjtuncsyefujajmjy-auth-token.0",
          value: "new-chunk",
          options: { secure: true, path: "/" },
        },
        {
          name: "sb-gntzjtuncsyefujajmjy-auth-token.1",
          value: "",
          options: { path: "/", maxAge: 0 },
        },
      ],
      {}
    );
    return { accountId: id, api: {} } as Awaited<ReturnType<typeof createFoundationRequestCaller>>;
  });
  const incoming = request("/dashboard", "sb-gntzjtuncsyefujajmjy-auth-token.1=obsolete");
  const response = await checkFoundationPageAccess(incoming, false);
  expect(incoming.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.value).toBe("new-chunk");
  expect(response.headers.get("x-middleware-request-cookie")).toContain("new-chunk");
  expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.1")?.value).toBe("");
  expect(response.cookies.get("sb-gntzjtuncsyefujajmjy-auth-token.0")?.secure).toBe(true);
  privateResponse(response);
});
it("ignores a stale phone hint and routes only missing verified phones to completion", async () => {
  read.mockResolvedValue({ ...base, phone: null });
  const response = await checkFoundationPageAccess(
    request("/post?area=market", "x-phone-ok=1"),
    false
  );
  const location = new URL(response.headers.get("location")!);
  expect(location.pathname).toBe("/dashboard/complete-profile");
  expect(location.searchParams.get("returnUrl")).toBe("/post?area=market");
  expect(
    (await checkFoundationPageAccess(request("/dashboard/complete-profile"), false)).headers.get(
      "x-middleware-next"
    )
  ).toBe("1");
});
it("does not send an unready staff account into the admin area", async () => {
  read.mockResolvedValue({
    ...base,
    staff: { role: "admin", can_access: false, assigned_capabilities: ["queue:view"] },
  });
  const response = await checkFoundationPageAccess(request("/admin/moderation"), false);
  const location = new URL(response.headers.get("location")!);
  expect(location.pathname).toBe("/staff/two-step");
  expect(location.searchParams.get("next")).toBe("/admin/moderation");
  expect((await checkFoundationPageAccess(request("/api/admin/users"), false)).status).toBe(403);
  expect(
    (await checkFoundationPageAccess(request("/staff/two-step"), false)).headers.get(
      "x-middleware-next"
    )
  ).toBe("1");
});
it.each(["moderator", "governor", "admin"] as const)(
  "accepts the canonical ready %s role without legacy role aliases",
  async (role) => {
    read.mockResolvedValue({
      ...base,
      staff: { role, can_access: true, assigned_capabilities: ["queue:view"] },
    });
    expect(
      (await checkFoundationPageAccess(request("/admin"), false)).headers.get("x-middleware-next")
    ).toBe("1");
  }
);
it("refuses an ordinary account access to staff setup and admin APIs", async () => {
  expect(
    (await checkFoundationPageAccess(request("/staff/two-step"), false)).headers.get("location")
  ).toBe("https://verifymzansi.com/dashboard");
  expect((await checkFoundationPageAccess(request("/api/admin"), false)).status).toBe(403);
});
it.each([
  [new FoundationSessionError(401), 401],
  [new FoundationSessionError(503), 503],
  [new Error("transport unavailable"), 503],
] as const)("fails closed on protected APIs for %s", async (error, status) => {
  call.mockRejectedValue(error);
  const response = await checkFoundationPageAccess(request("/api/account"), false);
  expect(response.status).toBe(status);
  privateResponse(response);
});
it("refuses revoked or suspended accounts even when the Auth session itself verifies", async () => {
  read.mockRejectedValue(new FoundationAccountContextError("forbidden"));
  expect((await checkFoundationPageAccess(request("/api/account"), false)).status).toBe(403);
  expect(
    (await checkFoundationPageAccess(request("/dashboard"), false)).headers.get("location")
  ).toBe("https://verifymzansi.com/error?reason=forbidden");
});
it("rejects an inconsistent account response instead of displaying another account", async () => {
  read.mockResolvedValue({ ...base, account_id: "00000000-0000-4000-8000-000000000002" });
  expect((await checkFoundationPageAccess(request("/api/account"), false)).status).toBe(503);
});
