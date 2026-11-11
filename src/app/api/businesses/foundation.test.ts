/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET as list, POST as create } from "./route";
import { GET as read, PATCH as update } from "./[id]/route";
import { restoredMarketplaceResponse } from "@/lib/foundation/marketplace-route";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";

vi.mock("@/lib/foundation/marketplace-route", () => ({ restoredMarketplaceResponse: vi.fn() }));
vi.mock("@/lib/foundation/restored-post-route", () => ({
  handleRestoredPostMutation: vi.fn(),
  handleRestoredPostRead: vi.fn(),
}));

const id = "00000000-0000-4000-8000-000000000001";
const answer = NextResponse.json({ ok: true });
const request = (method: string, path = "") =>
  new NextRequest(`https://verifymzansi.com/api/businesses${path}`, { method });

// The restored foundation handlers own validation, sign-in, CSRF and rate
// limits; they are tested in src/lib/foundation.
describe("/api/businesses on foundation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(restoredMarketplaceResponse).mockResolvedValue(answer as never);
    vi.mocked(handleRestoredPostMutation).mockResolvedValue(answer);
    vi.mocked(handleRestoredPostRead).mockResolvedValue(answer);
  });

  it("serves the public list from the restored marketplace reader", async () => {
    const req = request("GET");
    expect(await list(req)).toBe(answer);
    expect(restoredMarketplaceResponse).toHaveBeenCalledExactlyOnceWith(req, "businesses");
  });

  it("creates through the restored post mutation", async () => {
    const req = request("POST");
    expect(await create(req)).toBe(answer);
    expect(handleRestoredPostMutation).toHaveBeenCalledExactlyOnceWith(req, "businesses");
  });

  it("reads one post through the restored post reader", async () => {
    const req = request("GET", `/${id}`);
    expect(await read(req, { params: Promise.resolve({ id }) })).toBe(answer);
    expect(handleRestoredPostRead).toHaveBeenCalledExactlyOnceWith(req, "businesses", id);
  });

  it("updates one post through the restored post mutation", async () => {
    const req = request("PATCH", `/${id}`);
    expect(await update(req, { params: Promise.resolve({ id }) })).toBe(answer);
    expect(handleRestoredPostMutation).toHaveBeenCalledExactlyOnceWith(req, "businesses", id);
  });
});
