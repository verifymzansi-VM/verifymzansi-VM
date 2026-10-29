import { expect, it } from "vitest";
import { getPublishedPostingTerms, assertPublishedPostingTerms } from "./published-posting-terms";
import { buildTermsTextSections } from "./terms-text";
import manifest from "./terms-documents/catalogue.json";

it("prepares corrected expiry terms without changing historical acceptance or activating them", () => {
  expect(manifest.active_version).toBe("posting-v1");
  const next = getPublishedPostingTerms("posting-v2")!;
  expect(next.sections.flatMap((section) => section.content).join("\n")).toContain(
    "scheduled for deletion after 30 days"
  );
  expect(next.document_hash).not.toBe(manifest.versions["posting-v1"]);
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
