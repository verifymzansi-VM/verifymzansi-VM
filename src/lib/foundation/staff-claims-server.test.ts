import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFrontendStaffClaimViews, readMyFrontendStaffClaims } from "./staff-claims-server";
import { readFoundationServerSession } from "./server-session";
import { readFrontendStaffClaims } from "./staff-claims";

vi.mock("./server-session", () => ({ readFoundationServerSession: vi.fn() }));
vi.mock("./staff-claims", () => ({ readFrontendStaffClaims: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = uuid(1);
const api = { marker: "api" };
const claim = (id: string, mine: boolean) => ({
  id,
  item_type: "listing",
  mine,
  holder_name: mine ? "You" : "Another reviewer",
  expires_at: "2026-11-10T08:00:00+02:00",
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readFoundationServerSession).mockResolvedValue({ user: { id: staff }, api } as never);
});

describe("readMyFrontendStaffClaims", () => {
  it("reads the signed-in reviewer's own claims", async () => {
    vi.mocked(readFrontendStaffClaims).mockResolvedValueOnce({
      account_id: staff,
      items: [],
    } as never);
    await expect(readMyFrontendStaffClaims(staff)).resolves.toMatchObject({ account_id: staff });
    expect(readFrontendStaffClaims).toHaveBeenCalledWith(api, []);
  });

  it("refuses when the session now belongs to another staff account", async () => {
    vi.mocked(readFoundationServerSession).mockResolvedValueOnce({
      user: { id: uuid(2) },
      api,
    } as never);
    await expect(readMyFrontendStaffClaims(uuid(3))).rejects.toThrow("Staff account changed");
    expect(readFrontendStaffClaims).not.toHaveBeenCalled();
  });

  it("refuses a claim snapshot for another account", async () => {
    vi.mocked(readFoundationServerSession).mockResolvedValueOnce({
      user: { id: uuid(4) },
      api,
    } as never);
    vi.mocked(readFrontendStaffClaims).mockResolvedValueOnce({
      account_id: uuid(9),
      items: [],
    } as never);
    await expect(readMyFrontendStaffClaims(uuid(4))).rejects.toThrow("Staff claim account changed");
  });
});

describe("readFrontendStaffClaimViews", () => {
  it("returns only the requested items, keyed case-insensitively", async () => {
    const wanted = uuid(20);
    vi.mocked(readFrontendStaffClaims).mockResolvedValueOnce({
      account_id: staff,
      items: [claim(wanted, true), claim(uuid(21), false)],
    } as never);
    const views = await readFrontendStaffClaimViews(staff, [
      { type: "listing", id: wanted.toUpperCase() },
    ]);
    expect(views).toEqual({
      [`listing:${wanted}`]: {
        mine: true,
        holderName: "You",
        expiresAt: "2026-11-10T08:00:00+02:00",
      },
    });
  });

  it("asks in batches of at most 300 items", async () => {
    const items = Array.from({ length: 650 }, (_, i) => ({
      type: "listing" as const,
      id: uuid(100 + i),
    }));
    vi.mocked(readFrontendStaffClaims).mockResolvedValue({ account_id: staff, items: [] } as never);
    await readFrontendStaffClaimViews(staff, items);
    expect(vi.mocked(readFrontendStaffClaims).mock.calls.map(([, batch]) => batch.length)).toEqual([
      300, 300, 50,
    ]);
  });
});
