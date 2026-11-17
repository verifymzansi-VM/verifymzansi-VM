import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import {
  readNativeAdminFlags,
  readNativeDisplayFlags,
  readNativeGovernanceMetrics,
} from "./feature-controls-server";
import {
  readFrontendFeatureConfig,
  readFrontendFeatureFlags,
  readFrontendGovernanceMetrics,
} from "./feature-controls";
import { readFoundationServerSession } from "./server-session";
import { createFoundationServiceApi } from "./service-api";
import { FoundationStaffCommandError } from "./staff-command";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./feature-controls", () => ({
  readFrontendFeatureConfig: vi.fn(),
  readFrontendFeatureFlags: vi.fn(),
  readFrontendGovernanceMetrics: vi.fn(),
}));

const staff = "00000000-0000-4000-8000-000000000001";
const api = { marker: "caller" };
const service = { marker: "service" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: staff }, api } as never);
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
});

describe("readNativeDisplayFlags", () => {
  it("reads public display flags with the service API, without a session", async () => {
    vi.mocked(readFrontendFeatureConfig).mockResolvedValueOnce({ flag: true } as never);
    await expect(readNativeDisplayFlags()).resolves.toEqual({ flag: true });
    expect(readFrontendFeatureConfig).toHaveBeenCalledWith(service);
    expect(readFoundationServerSession).not.toHaveBeenCalled();
  });
});

describe.each([
  ["readNativeAdminFlags", readNativeAdminFlags, readFrontendFeatureFlags, "/admin/feature-flags"],
  [
    "readNativeGovernanceMetrics",
    readNativeGovernanceMetrics,
    readFrontendGovernanceMetrics,
    "/admin/governance/oversight",
  ],
] as const)("%s", (_name, read, reader, page) => {
  it("reads as the signed-in staff member", async () => {
    vi.mocked(reader).mockResolvedValueOnce({ ok: true } as never);
    await expect(read()).resolves.toEqual({ ok: true });
    expect(reader).toHaveBeenCalledWith(api, staff);
  });

  it("sends staff to verify again and back to the page when a second factor is due", async () => {
    vi.mocked(reader).mockRejectedValueOnce(new FoundationStaffCommandError(403, "verify", true));
    await expect(read()).rejects.toThrow(
      `redirect:/staff/two-step?confirm=1&next=${encodeURIComponent(page)}`
    );
  });

  it("passes other refusals through without redirecting", async () => {
    const refusal = new FoundationStaffCommandError(503, "unavailable");
    vi.mocked(reader).mockRejectedValueOnce(refusal);
    await expect(read()).rejects.toBe(refusal);
    expect(redirect).not.toHaveBeenCalled();
  });
});
