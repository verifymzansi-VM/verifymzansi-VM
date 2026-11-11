/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireVerifiedPostAccess } from "./require-verified-post-access";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";

const { redirect, warn } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error("redirect:" + path);
  }),
  warn: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/foundation/server-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationServerSession: vi.fn(),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

const RETURN = "/post/create-business";
const VERIFY = "/verification?returnUrl=%2Fpost%2Fcreate-business";
const read = vi.mocked(readFoundationServerSession);
const rpc = vi.fn();

function session() {
  return {
    user: { id: "00000000-0000-4000-8000-000000000001" },
    account: { account_id: "00000000-0000-4000-8000-000000000001", staff: null },
    api: { rpc } as unknown as FoundationAuthenticatedApi,
  } as unknown as Awaited<ReturnType<typeof readFoundationServerSession>>;
}
const readiness = (ready: boolean, phone = ready, locality = ready) => ({
  data: { verification_ready: ready, phone_verified: phone, locality_confirmed: locality },
  error: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue(session());
  rpc.mockResolvedValue(readiness(true));
});

describe("foundation backend", () => {
  it("lets a member through only when the database reports them ready", async () => {
    await expect(requireVerifiedPostAccess(RETURN)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_owner_verification_readiness", {});
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["identity not accepted yet", readiness(false, true, true)],
    ["no phone proof", readiness(false, false, true)],
    ["no confirmed area", readiness(false, true, false)],
    ["nothing done", readiness(false)],
  ])("sends a member who is not ready (%s) to /verification", async (_label, reply) => {
    rpc.mockResolvedValue(reply);
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a database error", { data: null, error: { code: "42501", message: "refused" } }],
    ["a malformed answer", { data: { verification_ready: "yes" }, error: null }],
    [
      "an inconsistent answer",
      {
        data: { verification_ready: true, phone_verified: false, locality_confirmed: true },
        error: null,
      },
    ],
    ["no answer", { data: null, error: null }],
  ])("fails closed to /verification on %s, with one redirect only", async (_label, reply) => {
    rpc.mockResolvedValue(reply);
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(VERIFY);
  });

  it("fails closed to /verification when the request itself fails", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("fails closed to /verification when the account session is unavailable", async () => {
    read.mockRejectedValue(new FoundationServerSessionError(503));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed to /verification on an unexpected session error", async () => {
    read.mockRejectedValue(new Error("boom"));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in and back to the form", async () => {
    read.mockRejectedValue(new FoundationServerSessionError(401));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow(
      "redirect:/login?returnUrl=%2Fpost%2Fcreate-business"
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends a refused account to the forbidden page", async () => {
    read.mockRejectedValue(new FoundationServerSessionError(403));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow(
      "redirect:/error?reason=forbidden"
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("logs why it failed closed, without identifiers", () => {
    const ID = "00000000-0000-4000-8000-000000000001";
    const EMAIL = "member@example.invalid";
    it.each([
      [
        "a database error keeps only its code",
        () =>
          rpc.mockResolvedValue({
            data: null,
            error: { code: "42501", message: `refused for ${ID}`, details: EMAIL, hint: ID },
          }),
        "Post access readiness unavailable",
        { reason: "rpc_error", code: "42501" },
      ],
      [
        "a gateway error code is kept",
        () =>
          rpc.mockResolvedValue({
            data: null,
            error: { code: "PGRST301", message: "JWT expired" },
          }),
        "Post access readiness unavailable",
        { reason: "rpc_error", code: "PGRST301" },
      ],
      [
        "an unexpected error code is dropped",
        () => rpc.mockResolvedValue({ data: null, error: { code: EMAIL, message: ID } }),
        "Post access readiness unavailable",
        { reason: "rpc_error", code: null },
      ],
      [
        "a malformed answer",
        () => rpc.mockResolvedValue({ data: { owner: ID, email: EMAIL }, error: null }),
        "Post access readiness unavailable",
        { reason: "malformed", code: null },
      ],
      [
        "a failed request",
        () => rpc.mockRejectedValue(new Error(`socket closed for ${EMAIL}`)),
        "Post access readiness unavailable",
        { reason: "request_failed", code: null },
      ],
      [
        "an unavailable session",
        () => read.mockRejectedValue(new FoundationServerSessionError(503)),
        "Post access session unavailable",
        { reason: "session_503" },
      ],
      [
        "an unexpected session error",
        () => read.mockRejectedValue(new Error(`no account ${ID} ${EMAIL}`)),
        "Post access session unavailable",
        { reason: "session_threw" },
      ],
    ] as const)("%s", async (_label, arrange, message, meta) => {
      arrange();
      await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(message, meta);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(ID);
      expect(logged).not.toContain(EMAIL);
      expect(logged).not.toMatch(/refused|socket|JWT|no account/);
    });

    it("logs nothing when the member is simply not ready yet", async () => {
      rpc.mockResolvedValue(readiness(false));
      await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("never puts an outside address in the verification return link", async () => {
    rpc.mockResolvedValue(readiness(false));
    await expect(requireVerifiedPostAccess("//evil.example/post")).rejects.toThrow(
      "redirect:/verification?returnUrl=%2F"
    );
  });
});

describe("the three create-form layouts (foundation backend)", () => {
  const layouts = {
    "/post/create-listing": () => import("@/app/post/create-listing/layout"),
    "/post/create-business": () => import("@/app/post/create-business/layout"),
    "/post/create-tourism": () => import("@/app/post/create-tourism/layout"),
  } as const;

  it.each(Object.keys(layouts) as (keyof typeof layouts)[])(
    "%s opens for a ready member and sends anyone else back to it after verification",
    async (path) => {
      const layout = (await layouts[path]()).default;
      await expect(layout({ children: "form" })).resolves.toBe("form");
      rpc.mockResolvedValue(readiness(false, true, true));
      await expect(layout({ children: "form" })).rejects.toThrow(
        "redirect:/verification?returnUrl=" + encodeURIComponent(path)
      );
    }
  );
});
