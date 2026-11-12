import { expect, it } from "vitest";
import {
  getPublishedPostingTerms,
  assertPublishedPostingTerms,
  postingTermsAwaitingForce,
} from "./published-posting-terms";
import { buildTermsTextSections } from "./terms-text";
import manifest from "./terms-documents/catalogue.json";
import { ENTERPRISE_PLANS, RETAIL_OFFERS } from "@/lib/constants/pricing";

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

it("publishes posting-v4 ahead of time without making it the active version", () => {
  expect(manifest.active_version).toBe("posting-v3");
  const v4 = getPublishedPostingTerms("posting-v4")!;
  expect(v4.document_hash).toBe("exBEhOdoAMyb9mANZYuHtoLBKqcSyex22eciypux6BI");
});

it("decides from the database's current version whether a version is in force yet", () => {
  const awaiting = (current: string | null, catalogue = manifest) =>
    Object.keys(catalogue.versions).filter((version) =>
      postingTermsAwaitingForce(version, current, catalogue)
    );
  expect(awaiting("posting-v3")).toEqual(["posting-v4"]);
  expect(awaiting("posting-v4")).toEqual([]);
  expect(awaiting("posting-v1")).toEqual(["posting-v2", "posting-v3", "posting-v4"]);
  // A release that already names posting-v4 active, deployed before the database
  // update that makes it current, still shows posting-v4 as not in force.
  const released = { ...manifest, active_version: "posting-v4" };
  expect(awaiting("posting-v3", released)).toEqual(["posting-v4"]);
  // Database unreadable (or a current version this release does not list): the
  // newest version and any version after the active one show the line.
  expect(awaiting(null)).toEqual(["posting-v4"]);
  expect(awaiting("posting-v9")).toEqual(["posting-v4"]);
  expect(awaiting(null, released)).toEqual(["posting-v4"]);
  expect(postingTermsAwaitingForce("posting-v5", "posting-v3")).toBe(false);
  expect(postingTermsAwaitingForce("constructor", null)).toBe(false);
});

// The site must never show one price while the Terms in force state another.
// These price constants feed the pricing page's default catalogue and the
// static price wording (FAQ, Advertise, plan step). In foundation mode the
// prices charged come from the database catalogue, which this test cannot see:
// the reviewed update that makes a new version current must check those
// (database/foundation/updates/README.md, Posting Terms v4).
it("keeps the site's price constants in step with the active Terms version", () => {
  const content = text(manifest.active_version);
  const rand = (cents: number) => `R${(cents / 100).toLocaleString("en-US")}`;
  expect(RETAIL_OFFERS.length).toBeGreaterThan(0);
  for (const offer of RETAIL_OFFERS)
    expect(content).toContain(`${rand(offer.priceCents)} for ${offer.durationDays} days`);
  // A "was" price is shown only while the active Terms allow discounts.
  const noDiscounts = content.includes("There are no discounts");
  const wasPrices = RETAIL_OFFERS.filter((offer) => offer.compareAtCents !== undefined);
  for (const offer of wasPrices)
    expect(noDiscounts, `${rand(offer.compareAtCents!)} was-price`).toBe(false);
  // Multi-listing prices are shown only while the active Terms cover
  // multi-listing plans or state each price.
  const multiListingCovered = content.includes(
    "Multi-listing plans bought online follow these Terms"
  );
  for (const plan of ENTERPRISE_PLANS)
    expect(
      multiListingCovered || content.includes(rand(plan.priceCents)),
      `${plan.planCode} ${rand(plan.priceCents)}`
    ).toBe(true);
});

it("states the Pricing v2 rules in posting-v4 (roadmap P1 checklist)", () => {
  const content = text("posting-v4");
  for (const rule of [
    // The slot rule and the Individual prices; no other package price.
    "The price is the slot price for each slot and each 30-day period: slot price × number of slots × number of 30-day periods. There are no discounts",
    "Individual slots cost R69 per slot for each 30 days: R69 for 30 days, R207 for 90 days or R414 for 180 days",
    "An Individual slot can hold a post in any of the three posting areas",
    "You may hold 1 to 4 Individual slots at a time",
    "The limit counts every Individual slot held by the same ID-reviewed person, and each slot has its own end date",
    "each paid slot can take at most 4 new posts in each 30-day period",
    "Each post may include one video. A video may be at most 2 minutes long, and a video for an event at most 1 minute",
    "All slots are prepaid; nothing renews automatically",
    "Paid time starts when your payment is confirmed, not when your post is approved",
    "if you renew a slot before it ends, the new days start when its current days end",
    "Price changes apply only to new purchases",
    "Orders of R10,000 or less are paid online",
    "For an order of more than R10,000, ask us for an invoice. We issue the invoice first and you pay it by EFT; the slots start when the money has cleared in our bank account",
    "After a payment is confirmed (for an invoice, once the money has cleared), we issue a payment record",
    "We do not add payment fees",
    "agree that the 7-day cooling-off period therefore does not apply, because the service starts immediately",
    "for an invoice order you confirm it when you ask for the invoice, and we record your confirmation before the invoice is paid",
    "under section 42(2)",
    "VerifyMzansi is not registered for VAT",
    // The refund and cancellation policy.
    "A change of mind is not a reason for a refund",
    "A rejected post is not a reason for a refund",
    "we first put it right by adding the days you lost",
    "The slot continues for 20 business days after we receive your request",
    "minus a cancellation fee of R50",
    "Closing your account counts as a request to cancel all your slots",
    "Buyers that are not individuals, such as companies, close corporations, trusts, partnerships and associations, are not refunded for unused days",
    "Billing errors and duplicate payments are refunded in full",
    "Refunds are paid only to the bank account that paid",
    "A purchase made under an earlier version of these Terms keeps the refund terms of that version",
    // A breach: content may be removed at once; a paid slot ends only after notice.
    "Removing content or suspending an account under Prohibited content does not end your paid slots",
    "the slot ends only if you have not remedied the breach within 20 business days after that notice (Consumer Protection Act, section 14(2)(b)(ii))",
    "Paid slots end only as set out under Refunds & cancelling below",
    // Unchanged lifecycle rules and the 3-day grace.
    "You may buy a slot and reactivate such a post within 3 days; after that the post and its media are deleted",
    "deletion waits up to 24 hours more",
    "A post you mark as sold leaves public view and is deleted with its media 3 days later",
    "A deactivated (paused) post keeps its posting slot",
    // The free first post, from its approval.
    "your first post is free for 7 days",
    "The 7 days start when we approve that post, not when you submit it",
    "(a paid slot, a sponsored place or a trial we granted you), the post uses that slot instead",
    // Partners and referral links.
    "we tell you which partner referred you and what that partner can see",
    "A partner never sees your contact details, ID details, payment details",
  ])
    expect(content).toContain(rule);
  for (const retired of [
    "R140",
    "R250",
    "R100",
    "R150",
    "30 days while",
    "launch spaces",
    "tax invoice",
    "or ask for a refund",
    "unused time on an active plan is not refunded",
    "Multi-listing plans bought online",
  ])
    expect(content).not.toContain(retired);
  // "R50" appears once, as the cancellation fee of the refund policy, never as a price.
  expect(content.match(/R50\b/g)).toEqual(["R50"]);
});

it("keeps posting-v3's unchanged sections in posting-v4 word for word", () => {
  const v3 = getPublishedPostingTerms("posting-v3")!;
  const v4 = getPublishedPostingTerms("posting-v4")!;
  const v3Section = (id: string) => v3.sections.find((section) => section.id === id)!;
  expect(v4.sections.map((section) => section.id)).toEqual([
    "acceptance",
    "registration",
    "posting-obligations",
    "prohibited-content",
    "our-role",
    "verification-signals",
    "payments",
    "paying",
    "refunds",
    "trials",
    "partners",
    "promotion-rights",
    "liability",
  ]);
  for (const id of [
    "acceptance",
    "registration",
    "our-role",
    "verification-signals",
    "promotion-rights",
    "liability",
  ])
    expect(v4.sections.find((section) => section.id === id)).toEqual(v3Section(id));
  const obligations = v4.sections.find((section) => section.id === "posting-obligations")!;
  expect(obligations.content.slice(0, -1)).toEqual(v3Section("posting-obligations").content);
  const prohibited = v4.sections.find((section) => section.id === "prohibited-content")!;
  expect(prohibited.content.slice(0, 5)).toEqual(
    v3Section("prohibited-content").content.slice(0, 5)
  );
  expect(v4.privacy_path).toBe(v3.privacy_path);
  expect(v4.company_details_path).toBe(v3.company_details_path);
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
