import { expect, it } from "vitest";
import { getPublishedPostingTerms, assertPublishedPostingTerms } from "./published-posting-terms";
import { buildTermsTextSections } from "./terms-text";
import manifest from "./terms-documents/catalogue.json";

const text = (version: string) =>
  getPublishedPostingTerms(version)!
    .sections.flatMap((section) => section.content)
    .join("\n");

it("keeps the never-current posting-v2 draft published but inactive", () => {
  expect(manifest.active_version).not.toBe("posting-v2");
  expect(text("posting-v2")).toContain("scheduled for deletion after 30 days");
  expect(getPublishedPostingTerms("posting-v2")!.document_hash).not.toBe(
    manifest.versions["posting-v1"]
  );
});

it("makes posting-v3 current with the post lifecycle rules decided on 9 November 2026", () => {
  expect(manifest.active_version).toBe("posting-v3");
  const v3 = getPublishedPostingTerms("posting-v3")!;
  expect(v3.document_hash).toBe("p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE");
  const content = text("posting-v3");
  for (const rule of [
    "The slot can be reused once the post in it is deleted",
    "a new post in the slot runs only for the plan's remaining days",
    "You may buy a plan and reactivate such a post within 3 days; after that the post and its media are deleted",
    "deletion waits up to 24 hours more",
    "the post is kept for 3 days after that payment",
    "A post you mark as sold leaves public view and is deleted with its media 3 days later",
    "it keeps its posting slot until then, you may delete it sooner to free the slot",
    "you may undo the sale within the 3 days",
    "A deactivated (paused) post keeps its posting slot",
    "An event is deleted when it ends",
    "the enquiries and other records linked to it are deleted with it",
  ])
    expect(content).toContain(rule);
  expect(content).not.toContain("stay saved");
  expect(content).not.toContain("Expiry alone does not delete them");
  // The notice clause and every other section are posting-v1's, unchanged.
  const v1 = getPublishedPostingTerms("posting-v1")!;
  expect(v3.sections.map((section) => section.id)).toEqual(v1.sections.map((s) => s.id));
  const changed = v3.sections.flatMap((section, s) =>
    section.content.flatMap((line, i) =>
      line === v1.sections[s].content[i] ? [] : [`${section.id}[${i}]`]
    )
  );
  expect(changed).toEqual(["payments[2]", "payments[3]", "trials[2]"]);
  expect(content).toContain("at least 14 days' notice");
});

it("shows the posting-v3 rules on the Terms page when no published version is read", () => {
  const fallback = buildTermsTextSections({});
  const v3 = getPublishedPostingTerms("posting-v3")!;
  for (const [id, index] of [
    ["payments", 2],
    ["payments", 3],
    ["trials", 2],
  ] as const)
    expect(fallback.find((section) => section.id === id)!.content[index]).toBe(
      v3.sections.find((section) => section.id === id)!.content[index]
    );
});

it("pins the archived document hash and rejects unknown versions", () => {
  for (const version of Object.keys(manifest.versions))
    expect(getPublishedPostingTerms(version)).not.toBeNull();
  const document = getPublishedPostingTerms("posting-v1")!;
  expect(document.document_hash).toBe("RAXTzmTyM5iMYeLy8Xv_NvnvzqsjUKPYq5hQaqqNS1Q");
  expect(document.sections.length).toBeGreaterThan(5);
  expect(getPublishedPostingTerms("../other")).toBeNull();
  expect(getPublishedPostingTerms("unpublished")).toBeNull();
  document.sections[0].content[0] = "Changed by a caller";
  expect(getPublishedPostingTerms("posting-v1")!.sections[0].content[0]).not.toBe(
    "Changed by a caller"
  );
});
it("describes account acceptance once per version rather than once per submitted post", () => {
  const content = getPublishedPostingTerms("posting-v1")!
    .sections.find((section) => section.id === "posting-obligations")!
    .content.join("\n");
  expect(content).toContain("once per account for each terms version");
  expect(content).toContain("review and accept the new version");
  expect(content).not.toContain("recorded against the submitted content");
});
it("only permits the database policy that matches the shipped immutable document", () => {
  const document = getPublishedPostingTerms("posting-v1")!;
  const policy = {
    version: document.version,
    document_hash: document.document_hash,
    document_path: `/terms/versions/${document.version}`,
  };
  expect(() => assertPublishedPostingTerms(policy)).not.toThrow();
  expect(() => assertPublishedPostingTerms({ ...policy, document_hash: "A".repeat(43) })).toThrow();
  expect(() => assertPublishedPostingTerms({ ...policy, document_path: "/terms" })).toThrow();
});
it("keeps the current Terms page's configured merchant and VAT paragraphs", () => {
  const current = buildTermsTextSections({
    ozowMerchantName: "Synthetic merchant",
    vatStatus: "Synthetic status",
  });
  expect(current.flatMap((section) => section.content).join("\n")).toContain("Synthetic merchant");
  expect(current.flatMap((section) => section.content).join("\n")).toContain("Synthetic status");
  expect(
    getPublishedPostingTerms("posting-v1")!
      .sections.flatMap((section) => section.content)
      .join("\n")
  ).not.toContain("Synthetic merchant");
});
