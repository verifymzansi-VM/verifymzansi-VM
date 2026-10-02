import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRefs,
  capturePendingSource,
  FEED_SESSION_LIMIT,
  FEED_SESSION_TTL_MS,
  feedSourceAttribute,
  parseSourceAttribute,
  safeReturnUrl,
  startSession,
} from "./session";

const ids = Array.from(
  { length: 5 },
  (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`
);

function renderList(attribute: string | null) {
  document.body.innerHTML = `
    <div ${attribute ? `data-feed-source='${attribute}'` : ""}>
      ${ids.map((id) => `<a href="/listing/${id}">card</a>`).join("")}
      <a href="/listing/${ids[0]}">clone of the first card</a>
    </div>`;
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/mzansi-market?category=vehicles");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("parseSourceAttribute", () => {
  it("accepts a list with its continuation and total", () => {
    const parsed = parseSourceAttribute(
      feedSourceAttribute({
        kind: "list",
        label: "Vehicles",
        api: "/api/listings",
        params: "category=vehicles",
        page: 2,
        pageSize: 24,
        total: 50,
      })
    );
    expect(parsed?.continuation).toEqual({
      api: "/api/listings",
      params: "category=vehicles",
      page: 2,
      pageSize: 24,
      total: 50,
    });
  });

  it("never trusts an unknown API or a malformed value", () => {
    expect(
      parseSourceAttribute(
        JSON.stringify({
          kind: "list",
          label: "x",
          api: "https://evil.example",
          params: "",
          page: 1,
          pageSize: 24,
        })
      )?.continuation
    ).toBeUndefined();
    expect(parseSourceAttribute("{not json")).toBeNull();
    expect(parseSourceAttribute(JSON.stringify({ kind: "admin" }))).toBeNull();
  });
});

describe("safeReturnUrl", () => {
  it("only allows same-site paths", () => {
    expect(safeReturnUrl("/mzansi-market?page=2")).toBe("/mzansi-market?page=2");
    expect(safeReturnUrl("//evil.example")).toBeNull();
    expect(safeReturnUrl("https://evil.example")).toBeNull();
    expect(safeReturnUrl("/\\evil")).toBeNull();
  });
});

describe("startSession", () => {
  it("continues through the clicked list from the clicked card, in display order", () => {
    const links = renderList(
      feedSourceAttribute({
        kind: "list",
        label: "Vehicles",
        api: "/api/listings",
        params: "",
        page: 1,
        pageSize: 24,
      })
    );
    capturePendingSource(links[2]);
    const { session, notice } = startSession({ kind: "l", id: ids[2] }, null);
    expect(notice).toBeNull();
    expect(session.source.label).toBe("Vehicles");
    expect(session.returnUrl).toBe("/mzansi-market?category=vehicles");
    expect(session.refs).toEqual([ids[2], ids[3], ids[4]].map((id) => `l.${id}`));
    expect(session.nextPage).toBe(2);
  });

  it("wraps a rotating showroom back to its first card", () => {
    const links = renderList(feedSourceAttribute({ kind: "rail", label: "Showroom", wrap: true }));
    capturePendingSource(links[3]);
    const { session } = startSession({ kind: "l", id: ids[3] }, null);
    expect(session.refs).toEqual([ids[3], ids[4], ids[0], ids[1], ids[2]].map((id) => `l.${id}`));
    expect(session.source.thenDirect).toBe(true);
  });

  it("starts a direct session for a card outside any list", () => {
    const links = renderList(null);
    capturePendingSource(links[1]);
    const { session } = startSession({ kind: "l", id: ids[1] }, null);
    expect(session.source.kind).toBe("direct");
    expect(session.refs).toEqual([`l.${ids[1]}`]);
  });

  it("reuses the same session when the page starts twice", () => {
    const links = renderList(feedSourceAttribute({ kind: "rail", label: "Showroom" }));
    capturePendingSource(links[0]);
    const first = startSession({ kind: "l", id: ids[0] }, null);
    const second = startSession({ kind: "l", id: ids[0] }, null);
    expect(second.session.id).toBe(first.session.id);
    expect(second.session.source.label).toBe("Showroom");
  });

  it("resumes the session named in the address after a refresh", () => {
    const links = renderList(feedSourceAttribute({ kind: "rail", label: "Showroom" }));
    capturePendingSource(links[0]);
    const { session } = startSession({ kind: "l", id: ids[0] }, null);
    const resumed = startSession({ kind: "l", id: ids[2] }, session.id, Date.now() + 60_000);
    expect(resumed.resumed).toBe(true);
    expect(resumed.session.id).toBe(session.id);
  });

  it("explains a missing or expired session and starts fresh from the post", () => {
    const links = renderList(feedSourceAttribute({ kind: "rail", label: "Showroom" }));
    capturePendingSource(links[0]);
    const { session } = startSession({ kind: "l", id: ids[0] }, null);
    const later = Date.now() + FEED_SESSION_TTL_MS + 1000;
    const expired = startSession({ kind: "l", id: ids[1] }, session.id, later);
    expect(expired.notice).toBe("expired");
    expect(expired.session.id).not.toBe(session.id);
    expect(expired.session.refs).toEqual([`l.${ids[1]}`]);
  });

  it("ignores a stale click on another card", () => {
    const links = renderList(feedSourceAttribute({ kind: "rail", label: "Showroom" }));
    capturePendingSource(links[0]);
    const { session } = startSession({ kind: "l", id: ids[4] }, null, Date.now() + 60_000);
    expect(session.source.kind).toBe("direct");
  });
});

describe("appendRefs", () => {
  it("never repeats a post and stops at the session cap", () => {
    const links = renderList(null);
    capturePendingSource(links[0]);
    const { session } = startSession({ kind: "l", id: ids[0] }, null);
    const repeated = appendRefs(session, [
      { kind: "l", id: ids[0] },
      { kind: "l", id: ids[1] },
    ]);
    expect(repeated.refs).toEqual([`l.${ids[0]}`, `l.${ids[1]}`]);

    const many = Array.from({ length: FEED_SESSION_LIMIT + 5 }, (_, index) => ({
      kind: "l" as const,
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const capped = appendRefs(session, many);
    expect(capped.refs).toHaveLength(FEED_SESSION_LIMIT);
    expect(capped.terminal).toBe("session_limit");
  });
});
