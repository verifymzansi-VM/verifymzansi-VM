import { describe, expect, it } from "vitest";
import { decodeRef, dedupeRefs, encodeRef, refFromHref, sameRef } from "./refs";

const ID = "ce4fda7f-8e21-4d7d-ab95-1d642b564f3c";
const OTHER = "f29d43fe-6570-45f2-b6bf-932750cce458";

describe("refFromHref", () => {
  it("reads the three public detail routes", () => {
    expect(refFromHref(`/listing/${ID}`)).toEqual({ kind: "l", id: ID });
    expect(refFromHref(`/mzansi-business/${ID}?x=1`)).toEqual({ kind: "b", id: ID });
    // Tourism businesses and events share a route: left for the server to resolve.
    expect(refFromHref(`/tourism-events/${ID}#top`)).toEqual({ kind: "t", id: ID });
  });

  it("ignores other links and other sites", () => {
    expect(refFromHref("/mzansi-market")).toBeNull();
    expect(refFromHref(`/listing/${ID}/edit-but-not-really-a-uuid`)).toBeNull();
    expect(
      refFromHref(`https://evil.example/listing/${ID}`, "https://verifymzansi.com")
    ).toBeNull();
    expect(
      refFromHref(`https://verifymzansi.com/listing/${ID}`, "https://verifymzansi.com")
    ).toEqual({
      kind: "l",
      id: ID,
    });
  });
});

describe("ref encoding", () => {
  it("round-trips and rejects junk", () => {
    expect(decodeRef(encodeRef({ kind: "p", id: ID }))).toEqual({ kind: "p", id: ID });
    expect(decodeRef("x.not-a-uuid")).toBeNull();
    expect(decodeRef(`z.${ID}`)).toBeNull();
  });

  it("matches an unresolved tourism ref to the post it resolves to", () => {
    expect(sameRef({ kind: "t", id: ID }, { kind: "p", id: ID })).toBe(true);
    expect(sameRef({ kind: "l", id: ID }, { kind: "b", id: ID })).toBe(false);
  });

  it("keeps the first of repeated cards (carousel clones)", () => {
    expect(
      dedupeRefs([
        { kind: "l", id: ID },
        { kind: "l", id: OTHER },
        { kind: "l", id: ID },
      ])
    ).toEqual([
      { kind: "l", id: ID },
      { kind: "l", id: OTHER },
    ]);
  });
});
