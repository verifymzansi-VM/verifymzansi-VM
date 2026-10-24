/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { requireStaff } from "./require-staff";
import {
  readFoundationServerSession,
  FoundationServerSessionError,
} from "@/lib/foundation/server-session";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error("redirect:" + path);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/foundation/server-session", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationServerSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const user: User = {
  id,
  email: "member@example.invalid",
  app_metadata: { role: "admin" },
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-10-24T00:00:00Z",
};
const read = vi.mocked(readFoundationServerSession);
function session(
  role: "moderator" | "governor" | "admin" | null = "moderator",
  ready = true,
  capabilities = ["queue:view"]
) {
  return {
    user,
    account: {
      version: 1,
      email: "member@example.invalid",
      phone: null,
      profile: {
        display_name: "Thando",
        public_name: "Thando",
        bio: null,
        avatar_object_id: null,
        legal_first_name: null,
        legal_last_name: null,
        legal_name_locked: false,
        identity_verified: false,
        revision: 1,
        updated_at: "2026-10-24T00:00:00Z",
      },
      account_id: id,
      totp_enrolled: true,
      staff: role ? { role, can_access: ready, assigned_capabilities: capabilities } : null,
    },
    api: { rpc: vi.fn() } as FoundationAuthenticatedApi,
  } as Awaited<ReturnType<typeof readFoundationServerSession>>;
}
beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue(session());
});
it("uses the canonical native role and never the retired profile client", async () => {
  await expect(requireStaff("queue:view")).resolves.toMatchObject({
    role: "moderator",
    assignedCapabilities: ["queue:view"],
  });
  expect(createClient).not.toHaveBeenCalled();
});
it("does not turn an Auth metadata admin claim into a staff assignment", async () => {
  read.mockResolvedValue(session(null));
  await expect(requireStaff()).rejects.toThrow("redirect:/dashboard");
});
it("uses the exact native capability assignment even when a legacy role alias would allow more", async () => {
  read.mockResolvedValue(session("governor", true, ["case:view"]));
  await expect(requireStaff("decision:approve")).rejects.toThrow("redirect:/admin");
  await expect(requireStaff("case:view")).resolves.toMatchObject({ role: "governance_controller" });
});
it("an empty native assignment cannot fall back to the legacy admin capability set", async () => {
  read.mockResolvedValue(session("admin", true, []));
  await expect(requireStaff("role:assign")).rejects.toThrow("redirect:/admin");
});
it("requires a fresh native factor for staff, while allowing the factor page itself", async () => {
  read.mockResolvedValue(session("moderator", false));
  await expect(requireStaff()).rejects.toThrow("redirect:/staff/two-step");
  await expect(requireStaff(undefined, { allowPendingMfa: true })).resolves.toMatchObject({
    mfa: { status: "required", hasFactor: true },
  });
});
it.each([
  [401, "/login"],
  [403, "/error?reason=forbidden"],
  [503, "/error?reason=unavailable"],
] as const)("keeps native failure %s separate from a source fallback", async (status, path) => {
  read.mockRejectedValue(new FoundationServerSessionError(status));
  await expect(requireStaff()).rejects.toThrow("redirect:" + path);
  expect(createClient).not.toHaveBeenCalled();
});
