/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as browse } from "./browse/route";
import { GET as direct } from "./direct/route";
import { GET as slides } from "./slides/route";
import {
  foundationBrowseSequence,
  foundationDirectSequence,
  foundationFeedSlides,
} from "@/lib/foundation/feed-read";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/foundation/feed-read", () => ({
  foundationBrowseSequence: vi.fn(),
  foundationDirectSequence: vi.fn(),
  foundationFeedSlides: vi.fn(),
}));

const post = "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3";
const url = (path: string) => new NextRequest(`https://verifymzansi.com/api/feed/${path}`);

it("loads feed slides from the foundation public reads", async () => {
  vi.mocked(foundationFeedSlides).mockResolvedValueOnce(new Map([[`l:${post}`, null]]));
  const res = await slides(url(`slides?refs=l.${post}`));
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await res.json()).toEqual({ v: 1, slides: [{ ref: `l:${post}`, slide: null }] });
  expect(foundationFeedSlides).toHaveBeenCalledExactlyOnceWith([{ kind: "l", id: post }]);
});

it("returns the foundation browse and direct sequences", async () => {
  vi.mocked(foundationBrowseSequence).mockResolvedValueOnce({
    refs: [{ kind: "l", id: post }],
    exhausted: false,
  });
  const listed = await browse(url("browse?v=market"));
  expect(await listed.json()).toEqual({ v: 1, refs: [`l.${post}`], terminal: "session_limit" });

  vi.mocked(foundationDirectSequence).mockResolvedValueOnce(null);
  expect((await direct(url(`direct?ref=l.${post}`))).status).toBe(404);
  vi.mocked(foundationDirectSequence).mockResolvedValueOnce({ refs: [], exhausted: true });
  expect(await (await direct(url(`direct?ref=l.${post}`))).json()).toEqual({
    v: 1,
    refs: [],
    terminal: "exhausted",
  });
});
