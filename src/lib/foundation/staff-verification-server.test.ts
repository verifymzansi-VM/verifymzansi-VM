import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRestoredStaffVerificationQueue } from "./staff-verification-server";
import { readFoundationServerSession } from "./server-session";
import { readFrontendStaffVerificationQueue } from "./staff-verification-queue";

vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./staff-verification-queue", () => ({ readFrontendStaffVerificationQueue: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = uuid(1);
const api = { marker: "api" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: staff }, api } as never);
});

describe("readRestoredStaffVerificationQueue", () => {
  it("reads 100 cases with no extra ids by default", async () => {
    vi.mocked(readFrontendStaffVerificationQueue).mockResolvedValueOnce({ items: [] } as never);
    await expect(readRestoredStaffVerificationQueue()).resolves.toEqual({ items: [] });
    expect(readFrontendStaffVerificationQueue).toHaveBeenCalledWith(api, staff, 100, []);
  });

  it("decodes the cache-safe id list it was given", async () => {
    await readRestoredStaffVerificationQueue(5, JSON.stringify([uuid(7), uuid(8)]));
    expect(readFrontendStaffVerificationQueue).toHaveBeenCalledWith(api, staff, 5, [
      uuid(7),
      uuid(8),
    ]);
  });

  it("refuses a malformed id list", async () => {
    await expect(readRestoredStaffVerificationQueue(6, "[not json")).rejects.toThrow(SyntaxError);
    expect(readFrontendStaffVerificationQueue).not.toHaveBeenCalled();
  });
});
