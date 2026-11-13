/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./slides/route";
import { loadFeedSlides } from "@/lib/feed/load-slides";
import { createAdminClient, tryCreateAdminClient } from "@/lib/supabase/admin";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/feed/load-slides", () => ({ loadFeedSlides: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));
vi.mock("@/lib/supabase/admin", () => {
  const retired = vi.fn(() => {
    throw new Error("Retired backend used");
  });
  return { createAdminClient: retired, tryCreateAdminClient: retired };
});

const post = "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3";

it("loads feed slides without a retired service client", async () => {
  vi.mocked(loadFeedSlides).mockResolvedValueOnce(new Map([[`l:${post}`, null]]));
  const res = await GET(new NextRequest(`https://verifymzansi.com/api/feed/slides?refs=l.${post}`));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ v: 1, slides: [{ ref: `l:${post}`, slide: null }] });
  expect(vi.mocked(loadFeedSlides).mock.calls[0][0]).toMatchObject({ admin: null });
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(tryCreateAdminClient).not.toHaveBeenCalled();
});
