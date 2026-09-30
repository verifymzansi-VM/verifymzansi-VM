import { describe, expect, it, vi } from "vitest";
import { checkStorageQuota } from "./settings";

describe("storage quota", () => {
  it.each([0, "0", 900, "900"])("allows usage at or below the quota: %s", async (data) => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
    expect(await checkStorageQuota(admin, "owner", 100, 1000, 1)).toBeNull();
    expect(admin.rpc).toHaveBeenCalledWith("media_storage_used", { p_user: "owner" });
  });

  it("rejects uploads above the quota", async () => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data: 901, error: null }) };
    expect(await checkStorageQuota(admin, "owner", 100, 1000, 1)).toContain("allowance");
  });

  it.each([
    null,
    undefined,
    "",
    "bad",
    false,
    {},
    [],
    -1,
    1.5,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("blocks uploads when storage usage is malformed: %j", async (data) => {
    const admin = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
    await expect(checkStorageQuota(admin, "owner", 100, 1000, 1)).rejects.toThrow(
      "usage is unavailable"
    );
  });

  it("blocks uploads on an RPC error even if a numeric value is returned", async () => {
    const admin = {
      rpc: vi.fn().mockResolvedValue({ data: 0, error: { message: "database failure" } }),
    };
    await expect(checkStorageQuota(admin, "owner", 100, 1000, 1)).rejects.toThrow(
      "usage is unavailable"
    );
  });

  it("blocks uploads when the usage request rejects", async () => {
    const admin = { rpc: vi.fn().mockRejectedValue(new Error("network unavailable")) };
    await expect(checkStorageQuota(admin, "owner", 100, 1000, 1)).rejects.toThrow(
      "network unavailable"
    );
  });
});
