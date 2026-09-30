import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";

const { verifyCapabilityFromDb } = vi.hoisted(() => ({ verifyCapabilityFromDb: vi.fn() }));
vi.mock("@/lib/auth/admin-access", () => ({ verifyCapabilityFromDb }));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { hasStaffPostingLimitBypass } from "./staff-posting-bypass";

const mockedMfa = vi.mocked(checkStaffApiMfa);
const supabase = {} as never;
const user = { id: "staff-1", app_metadata: {}, is_anonymous: false };

describe("hasStaffPostingLimitBypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMfa.mockResolvedValue(null);
  });

  it("denies users without the capability without consulting MFA", async () => {
    verifyCapabilityFromDb.mockResolvedValue(false);
    await expect(hasStaffPostingLimitBypass(supabase, user)).resolves.toBe(false);
    expect(mockedMfa).not.toHaveBeenCalled();
  });

  it("denies staff who have the capability but have not satisfied staff MFA", async () => {
    verifyCapabilityFromDb.mockResolvedValue(true);
    mockedMfa.mockResolvedValue(
      NextResponse.json({ code: "mfa_required" }, { status: 403 }) as never
    );
    await expect(hasStaffPostingLimitBypass(supabase, user)).resolves.toBe(false);
    expect(mockedMfa).toHaveBeenCalledWith(supabase, "staff-1");
  });

  it("fails closed when the MFA lookup throws", async () => {
    verifyCapabilityFromDb.mockResolvedValue(true);
    mockedMfa.mockRejectedValue(new Error("db down"));
    await expect(hasStaffPostingLimitBypass(supabase, user)).resolves.toBe(false);
  });

  it("grants the bypass to MFA-satisfied staff with the capability", async () => {
    verifyCapabilityFromDb.mockResolvedValue(true);
    await expect(hasStaffPostingLimitBypass(supabase, user)).resolves.toBe(true);
  });
});

describe("posting routes use the MFA-gated bypass", () => {
  const routes = ["listings", "businesses", "promotions"];

  it.each(routes)("/api/%s POST never grants posting:bypass_limits on role alone", (route) => {
    const source = readFileSync(join(process.cwd(), "src/app/api", route, "route.ts"), "utf8");
    expect(source).not.toMatch(/verifyCapabilityFromDb\(\s*user,\s*"posting:bypass_limits"/);
    expect(source).toMatch(/hasStaffPostingLimitBypass\(supabase, user\)/);
  });
});
