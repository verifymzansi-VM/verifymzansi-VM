/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireVerifiedPostAccess } from "./require-verified-post-access";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { createClient } from "@/lib/supabase/server";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";

const { redirect, backend } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error("redirect:" + path);
  }),
  backend: { mode: "foundation" as "foundation" | "source" },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => backend.mode }));
vi.mock("@/lib/foundation/server-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationServerSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/account/resolved-verification", () => ({ resolveAccountVerification: vi.fn() }));

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
  backend.mode = "foundation";
  read.mockResolvedValue(session());
  rpc.mockResolvedValue(readiness(true));
});

describe("foundation backend", () => {
  it("lets a member through only when the database reports them ready", async () => {
    await expect(requireVerifiedPostAccess(RETURN)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_owner_verification_readiness", {});
    expect(redirect).not.toHaveBeenCalled();
    // Never the retired backend's tables or client.
    expect(createClient).not.toHaveBeenCalled();
    expect(resolveAccountVerification).not.toHaveBeenCalled();
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
    expect(createClient).not.toHaveBeenCalled();
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
    expect(createClient).not.toHaveBeenCalled();
  });

  it("sends a refused account to the forbidden page", async () => {
    read.mockRejectedValue(new FoundationServerSessionError(403));
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow(
      "redirect:/error?reason=forbidden"
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never puts an outside address in the verification return link", async () => {
    rpc.mockResolvedValue(readiness(false));
    await expect(requireVerifiedPostAccess("//evil.example/post")).rejects.toThrow(
      "redirect:/verification?returnUrl=%2F"
    );
  });
});

describe("source backend (unchanged)", () => {
  function legacyClient(user: { id: string } | null) {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    } as unknown as Awaited<ReturnType<typeof createClient>>);
  }
  beforeEach(() => {
    backend.mode = "source";
  });

  it("lets a verified member through without the foundation session", async () => {
    legacyClient({ id: "user-1" });
    vi.mocked(resolveAccountVerification).mockResolvedValue({
      accountVerificationStatus: "verified",
    } as Awaited<ReturnType<typeof resolveAccountVerification>>);
    await expect(requireVerifiedPostAccess(RETURN)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(resolveAccountVerification).toHaveBeenCalledWith(expect.anything(), "user-1", {
      includeStepsWhenVerified: true,
    });
  });

  it("sends an unverified member to /verification", async () => {
    legacyClient({ id: "user-1" });
    vi.mocked(resolveAccountVerification).mockResolvedValue({
      accountVerificationStatus: "pending_review",
    } as Awaited<ReturnType<typeof resolveAccountVerification>>);
    await expect(requireVerifiedPostAccess(RETURN)).rejects.toThrow("redirect:" + VERIFY);
  });

  it("leaves a signed-out visitor to the page, as before", async () => {
    legacyClient(null);
    await expect(requireVerifiedPostAccess(RETURN)).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
    expect(resolveAccountVerification).not.toHaveBeenCalled();
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
      expect(createClient).not.toHaveBeenCalled();
    }
  );
});
