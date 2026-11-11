import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { readRestoredGovernancePage } from "./governance-server";
import { readRestoredGovernance } from "./governance";
import { readFoundationServerSession } from "./server-session";
import { FoundationStaffCommandError } from "./staff-command";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./governance", () => ({ readRestoredGovernance: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = uuid(1);
const api = { marker: "api" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redirect).mockImplementation((url: string) => {
    throw new Error(`redirect:${url}`);
  });
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: staff }, api } as never);
});

describe("readRestoredGovernancePage", () => {
  it("reads the open queue for the signed-in staff member", async () => {
    vi.mocked(readRestoredGovernance).mockResolvedValueOnce(["row"] as never);
    await expect(readRestoredGovernancePage(25)).resolves.toEqual(["row"]);
    expect(readRestoredGovernance).toHaveBeenCalledWith(api, staff, { limit: 25 });
  });

  it("reads one escalation in any status by id", async () => {
    vi.mocked(readRestoredGovernance).mockResolvedValueOnce([] as never);
    await readRestoredGovernancePage(1, uuid(5));
    expect(readRestoredGovernance).toHaveBeenCalledWith(api, staff, {
      limit: 1,
      id: uuid(5),
      status: "all",
    });
  });

  it.each([
    [undefined, "/admin/governance/escalations"],
    [uuid(6), `/admin/governance/escalations/${uuid(6)}`],
  ])("sends staff to verify again and back to %s when a second factor is due", async (id, back) => {
    vi.mocked(readRestoredGovernance).mockRejectedValueOnce(
      new FoundationStaffCommandError(403, "verify", true)
    );
    await expect(readRestoredGovernancePage(2, id)).rejects.toThrow(
      `redirect:/staff/two-step?confirm=1&next=${encodeURIComponent(back)}`
    );
  });

  it("passes other refusals through without redirecting", async () => {
    const refusal = new FoundationStaffCommandError(403, "not staff");
    vi.mocked(readRestoredGovernance).mockRejectedValueOnce(refusal);
    await expect(readRestoredGovernancePage(3)).rejects.toBe(refusal);
    expect(redirect).not.toHaveBeenCalled();
  });
});
