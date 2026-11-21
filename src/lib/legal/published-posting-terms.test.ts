import { expect, it } from "vitest";
import { getPublishedPostingTerms, assertPublishedPostingTerms } from "./published-posting-terms";
import { buildTermsTextSections } from "./terms-text";
import manifest from "./terms-documents/catalogue.json";
import { PACKAGES_ON_SALE, RETAIL_OFFERS } from "@/lib/constants/pricing";
import { PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS } from "@/lib/billing/slot-packages";
import { buildCommercialCatalog, buildFoundationCommercialCatalog } from "@/lib/commercial/plans";
import { POSTS_PER_SLOT_PER_30_DAYS } from "@/lib/billing/slot-checkout";
import { readFileSync } from "node:fs";

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

it("keeps posting-v4 published unchanged", () => {
  const v4 = getPublishedPostingTerms("posting-v4")!;
  expect(v4.document_hash).toBe("HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg");
  // Visitors never see version names: the text does not mention versions.
  expect(text("posting-v4")).not.toMatch(/version/i);
});

// The site must never show one price while the Terms in force state another.
// These price constants feed the pricing page's prices while nothing is on
// sale (and its fallback) and the static price wording (FAQ, Advertise, plan
// step). In foundation mode what can be bought comes from the database
// catalogue, which this test cannot see: the switch update takes the old plans
// off sale (database/foundation/updates/README.md, Posting Terms v4).
it("keeps the site's price constants in step with the active Terms", () => {
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
  // Multi-listing prices are shown only while packages are on sale and the
  // active Terms cover multi-listing packages or state the package slot price.
  const multiListingCovered = content.includes(
    "Multi-listing plans bought online follow these Terms"
  );
  expect(
    !PACKAGES_ON_SALE ||
      multiListingCovered ||
      content.includes(`${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot`),
    `package slot price ${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)}`
  ).toBe(true);
  // With no plan on sale in the database, nothing links to checkout.
  expect(buildCommercialCatalog([]).onSale).toBe(false);
});

// What the database puts on sale (the reviewed update that sells the R69
// slots) must be what the Terms in force state and what the site shows.
it("puts on sale exactly the Individual slots the active Terms state, at the site's prices", () => {
  const content = text(manifest.active_version);
  const sql = readFileSync(
    "database/foundation/updates/20261113002421_individual_slots_r69.sql",
    "utf8"
  );
  const insert = sql.slice(sql.indexOf("insert into private.plan_versions"));
  const rows = [
    ...insert
      .slice(0, insert.indexOf("on conflict"))
      .matchAll(
        /\('([0-9a-f-]{36})', '(individual_\d+d)', 1, null, '([^']+)', (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+),/g
      ),
  ].map(([, id, code, label, price, days, slots, activations, period, photos, videos]) => ({
    id,
    code,
    label,
    price: Number(price),
    days: Number(days),
    slots: Number(slots),
    activations: Number(activations),
    period: Number(period),
    photos: Number(photos),
    videos: Number(videos),
  }));
  expect(rows.map((row) => [row.code, row.price, row.days])).toEqual(
    RETAIL_OFFERS.map((offer) => [
      `individual_${offer.durationDays}d`,
      offer.priceCents,
      offer.durationDays,
    ])
  );
  const rand = (cents: number) => `R${(cents / 100).toLocaleString("en-US")}`;
  for (const row of rows) {
    // R69 per slot for each 30 days, no discounts.
    expect(row.price).toBe(6900 * (row.days / 30));
    expect(content).toContain(`${rand(row.price)} for ${row.days} days`);
    expect([row.slots, row.period, row.photos, row.videos]).toEqual([1, 30, 10, 1]);
    expect(row.activations).toBe(POSTS_PER_SLOT_PER_30_DAYS);
  }
  expect(content).toContain(
    `each paid slot can take at most ${POSTS_PER_SLOT_PER_30_DAYS} posts going live in each 30-day period`
  );
  expect(content).toContain("You may hold 1 to 4 Individual slots at a time");
  // No fixed online limit: only the payment provider's maximum (posting-v5).
  expect(content).not.toMatch(/R10,000/);
  expect(content).toContain("Our payment provider sets a maximum for each online payment");
  // The pricing page sells those plans, in every section, at those prices.
  const catalogue = buildFoundationCommercialCatalog({
    plans: rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      area: null,
      price_cents: String(row.price),
      currency: "ZAR" as const,
      duration_days: row.days,
      activation_period_days: row.period,
      activations_per_period: row.activations,
      slot_capacity: row.slots,
      max_photos: row.photos,
      max_videos: row.videos,
      addon_capabilities: [],
    })),
    addons: [],
  });
  expect(catalogue.onSale).toBe(true);
  expect(
    catalogue.retail.map((offer) => [offer.priceCents, new Set(Object.values(offer.planIds)).size])
  ).toEqual(rows.map((row) => [row.price, 1]));
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
    "each paid slot can take at most 4 posts going live in each 30-day period. A new post and an ended post brought back each count; editing a live post does not",
    "Slots are on sale only when the pricing page offers them. While they are not on sale, the pricing page says so and nothing can be bought",
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
    "you may cancel a slot by writing to billing@verifymzansi.com from the email address of your account",
    "The slot continues for 20 business days after we receive your request",
    "minus a cancellation fee of R50",
    "Closing your account counts as a request to cancel all your slots",
    "Buyers that are not individuals, such as companies, close corporations, trusts, partnerships and associations, are not refunded for unused days",
    "Billing errors and duplicate payments are refunded in full",
    "Refunds are paid only to the bank account that paid",
    "Before submitting a post, you must explicitly accept these Terms",
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
    // The free post rule as the database applies it (internal.start_intro_trial,
    // internal.start_sponsorship and internal.grant_intro_trial record the free
    // post; a paid slot does not).
    "you already have an unused paid slot with at least 7 days left that allows the post's photos and video, the post uses that slot instead and your free post stays unused",
    "A sponsored place, or a free post we grant you, counts as your free post",
    // Partners and referral links.
    // Partners as built (internal.record_my_acquisition, internal.my_partner_dashboard).
    "A partner's link or code counts only if it is recorded within 7 days after you sign up",
    "that record cannot be changed afterwards, so you can be linked to one partner at most",
    "You may ask us at any time which partner, if any, referred you",
    "A partner sees how many people they referred and how many of them have paid, and for each payment its amount and the commission it earned",
    "A partner never sees your name, contact details, ID details, bank or card details",
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

// Owner's decisions of 16 November 2026: no R10,000 online limit; an invoice
// first at any amount, paid with Pay now or by EFT; above the payment
// provider's maximum (internal.online_payment_max_cents), an invoice paid by
// EFT. posting-v5 is posting-v4 with only those paragraphs changed.
it("makes posting-v5 the site's one set of Terms, stating how people pay now", () => {
  expect(manifest.active_version).toBe("posting-v5");
  const v5 = getPublishedPostingTerms("posting-v5")!;
  expect(v5.document_hash).toBe("LkgzMkvecZ75fguL1-eUNxwRsHZpg9pi42CTae2Q5mc");
  const content = text("posting-v5");
  expect(content).not.toMatch(/version/i);
  for (const rule of [
    "You can pay online in South African rand through our payment provider's secure hosted checkout",
    "If you need an invoice before you pay, ask for one at checkout. We issue the invoice first",
    "You pay it online with Pay now, through the same secure checkout, or by EFT into the bank account shown on the invoice",
    "The slots start when the payment is confirmed; for an EFT, when the money has cleared in our bank account",
    "Our payment provider sets a maximum for each online payment, and the checkout shows it",
    "An order or invoice above that maximum cannot be paid online: we issue an invoice and you pay it by EFT",
    "A renewal is not invoiced: if renewing your slots together would be above that maximum, renew them in more than one payment",
    "At the online checkout, and before you pay an invoice with Pay now, you tick a box",
    "if you pay an invoice by EFT, you confirm it when you ask for the invoice",
    "through our payment provider's refund service (or by EFT for a payment made by EFT)",
  ])
    expect(content).toContain(rule);
  for (const retired of ["R10,000", "Orders of", "For an order of more than"])
    expect(content).not.toContain(retired);
  const v4 = getPublishedPostingTerms("posting-v4")!;
  expect(v5.sections.map((section) => section.id)).toEqual(v4.sections.map((s) => s.id));
  const changed = v5.sections.flatMap((section, s) =>
    section.content.flatMap((line, i) =>
      line === v4.sections[s].content[i] ? [] : [`${section.id}[${i}]`]
    )
  );
  expect(changed).toEqual([
    "paying[0]",
    "paying[1]",
    "paying[2]",
    "paying[3]",
    "paying[4]",
    "paying[5]",
    "paying[6]",
    "refunds[7]",
  ]);
  // paying[3] and paying[5] are posting-v4's price and VAT paragraphs, moved down one.
  const v4Paying = v4.sections.find((section) => section.id === "paying")!.content;
  const v5Paying = v5.sections.find((section) => section.id === "paying")!.content;
  expect([v5Paying[3], v5Paying[5]]).toEqual([v4Paying[2], v4Paying[4]]);
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
  expect(obligations.content.slice(0, 5)).toEqual(
    v3Section("posting-obligations").content.slice(0, 5)
  );
  const prohibited = v4.sections.find((section) => section.id === "prohibited-content")!;
  expect(prohibited.content.slice(0, 5)).toEqual(
    v3Section("prohibited-content").content.slice(0, 5)
  );
  expect(v4.privacy_path).toBe(v3.privacy_path);
  expect(v4.company_details_path).toBe(v3.company_details_path);
});

it("shows the current Terms word for word when the published Terms cannot be read", () => {
  const fallback = buildTermsTextSections({});
  const current = getPublishedPostingTerms(manifest.active_version)!;
  expect(fallback).toEqual(
    current.sections.map(({ id, navLabel, title, content }) => ({ id, navLabel, title, content }))
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
it("keeps the current Terms page's configured merchant paragraph", () => {
  const current = buildTermsTextSections({ ozowMerchantName: "Synthetic merchant" });
  expect(current.flatMap((section) => section.content).join("\n")).toContain("Synthetic merchant");
  expect(
    getPublishedPostingTerms("posting-v1")!
      .sections.flatMap((section) => section.content)
      .join("\n")
  ).not.toContain("Synthetic merchant");
});
