// Guard (launch checklist item 27): once posting-v6 is the active version, the
// Multi-listing package prices and rules the site shows
// (src/lib/billing/slot-packages.ts) must be the ones the Terms state, and the
// database catalogue must charge them. Paid add-ons are not offered, so
// posting-v6 does not mention them.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./terms-documents/catalogue.json";
import { getPublishedPostingTerms } from "./published-posting-terms";
import { PLANS, RETAIL_OFFERS } from "@/lib/constants/pricing";
import {
  PACKAGE_ADD_INVOICE_DUE_DAYS,
  PACKAGE_ADD_MIN_DAYS,
  PACKAGE_ADD_MIN_INVOICE_DAYS,
  PACKAGE_MAX_ONLINE_SLOTS,
  PACKAGE_MAX_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  PACKAGE_TERMS,
  packageTotalCents,
} from "@/lib/billing/slot-packages";

const rand = (cents: number) => `R${(cents / 100).toLocaleString("en-US")}`;
const list = (items: readonly string[]) =>
  `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
const rands = (text: string) => [...new Set(text.match(/R[\d,]+(?:\.\d\d)?\b/g) ?? [])].sort();

const active = getPublishedPostingTerms(manifest.active_version)!;
const section = (id: string) => {
  const found = active.sections.find((entry) => entry.id === id);
  expect(found, `section ${id}`).toBeDefined();
  return found!.content.join("\n");
};
const individual30 = RETAIL_OFFERS.find((offer) => offer.durationDays === 30)!;

describe("the active Terms state the site's package prices", () => {
  it("is posting-v6 or later", () => {
    expect(Number(manifest.active_version.replace("posting-v", ""))).toBeGreaterThanOrEqual(6);
  });

  it("states the Multi-listing package price, sizes, terms and limits", () => {
    const packages = section("packages");
    const perTerm = PACKAGE_TERMS.map(
      (days) => `${rand(packageTotalCents(1, days))} for ${days} days`
    );
    for (const rule of [
      `one purchase of ${PACKAGE_MIN_SLOTS} to ${PACKAGE_MAX_SLOTS} slots for one term of ${list(PACKAGE_TERMS.map(String))} days`,
      `The price is ${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot for each 30 days: ${list(perTerm)}.`,
      `Package slots cost ${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} each for 30 days, and Individual slots ${rand(individual30.priceCents)}.`,
      `at most ${PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} posts going live for each of its slots in any 30 days, counted across the whole package`,
      `each added slot costs ${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} × days left ÷ 30, rounded to the cent`,
      `up to ${PACKAGE_MAX_SLOTS} slots in all`,
      `online while at least ${PACKAGE_ADD_MIN_DAYS} whole days are left, and by invoice while at least ${PACKAGE_ADD_MIN_INVOICE_DAYS} whole days are left`,
      `due ${PACKAGE_ADD_INVOICE_DUE_DAYS} days after we issue it, or on the package's last day if that is sooner`,
      "end together, at the same moment",
      "An account can hold one package at a time",
      "only after your ID review has been accepted",
      "A package does not renew automatically",
    ])
      expect(packages).toContain(rule);
    // Photos and video per post: the same as every paid slot on the site.
    const features = new Set(
      PLANS.map((plan) => `${plan.features.maxPhotos}/${plan.features.maxVideos}`)
    );
    expect([...features]).toEqual(["10/1"]);
    expect(packages).toContain("with up to 10 photos and 1 video per post");
    // No other amount appears among the package rules.
    expect(rands(packages)).toEqual(
      [
        ...new Set([
          ...PACKAGE_TERMS.map((days) => rand(packageTotalCents(1, days))),
          rand(individual30.priceCents),
        ]),
      ].sort()
    );
    // The worked example under Slots & prices.
    expect(section("payments")).toContain(
      `a package of 25 slots for 90 days costs 25 × 3 × ${rand(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} = ${rand(packageTotalCents(25, 90))}`
    );
    // Above 100 slots, by invoice at the same price.
    const paying = section("paying");
    expect(paying).toContain(
      `A Multi-listing package of more than ${PACKAGE_MAX_ONLINE_SLOTS} slots, and added slots that take a package above ${PACKAGE_MAX_ONLINE_SLOTS} slots, are paid by invoice too. An invoice costs the same as paying online.`
    );
    expect(paying).toContain("We never charge interest or a late fee on an invoice.");
  });

  it("matches what the database catalogue charges for packages", () => {
    const packageSql = readFileSync(
      "database/foundation/updates/20261114154823_slot_packages.sql",
      "utf8"
    );
    const insert = packageSql.slice(packageSql.indexOf("insert into private.plan_versions"));
    const rows = [
      ...insert
        .slice(0, insert.indexOf("on conflict"))
        .matchAll(
          /'(slot_package_\d+d)', 1, null, '[^']+', (\d+), (\d+),\s*1,\s*(\d+), 30, (\d+), (\d+),/g
        ),
    ].map(([, code, price, days, activations, photos, videos]) => ({
      code,
      price: Number(price),
      days: Number(days),
      activations: Number(activations),
      photos: Number(photos),
      videos: Number(videos),
    }));
    expect(rows).toEqual(
      PACKAGE_TERMS.map((days) => ({
        code: `slot_package_${days}d`,
        price: packageTotalCents(1, days),
        days,
        activations: PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
        photos: 10,
        videos: 1,
      }))
    );
  });
});

// posting-v6 is posting-v5 plus the package rules and the settled legal answers
// that belong in the Terms; every other paragraph is unchanged.
describe("posting-v6", () => {
  const v5 = getPublishedPostingTerms("posting-v5")!;
  const v6 = getPublishedPostingTerms("posting-v6")!;
  const text = v6.sections.flatMap((entry) => entry.content).join("\n");

  it("is the site's one set of Terms, with its pinned hash", () => {
    expect(manifest.active_version).toBe("posting-v6");
    expect(v6.document_hash).toBe("UauuSM0-qjrP3AhiX1eHWOi0FLSSWpKfbW1dKZBAr_s");
    expect(text).not.toMatch(/version/i);
  });

  it("adds one section and keeps every other section's order and v5 text", () => {
    expect(v6.sections.map((entry) => entry.id)).toEqual([
      "acceptance",
      "registration",
      "posting-obligations",
      "prohibited-content",
      "our-role",
      "verification-signals",
      "payments",
      "packages",
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
      "trials",
      "partners",
      "liability",
    ])
      expect(v6.sections.find((entry) => entry.id === id)).toEqual(
        v5.sections.find((entry) => entry.id === id)
      );
    // Every v5 paragraph of the changed sections is still there, word for
    // word, except the ones posting-v6 rewrites.
    const rewritten = new Set([
      "payments[0]",
      "payments[2]",
      "payments[3]",
      "payments[5]",
      "payments[8]",
      "payments[9]",
      "paying[2]",
      "refunds[0]",
      "refunds[2]",
      "refunds[3]",
      "refunds[6]",
      "refunds[7]",
      "refunds[8]",
    ]);
    for (const old of v5.sections) {
      const now = v6.sections.find((entry) => entry.id === old.id)!;
      old.content.forEach((line, i) => {
        if (!rewritten.has(`${old.id}[${i}]`))
          expect(now.content, `${old.id}[${i}]`).toContain(line);
      });
    }
    expect(v6.privacy_path).toBe(v5.privacy_path);
    expect(v6.company_details_path).toBe(v5.company_details_path);
  });

  it("states the settled legal answers that belong in the Terms", () => {
    for (const rule of [
      // A3, A6, C1: cancelling a package, no transfers, refunds.
      "you may cancel a slot or a package by writing to billing@verifymzansi.com",
      "A package is cancelled as a whole, with any slots added to it, and one fee of R50 applies to the package",
      "Buyers that are not individuals, such as companies, close corporations, trusts, partnerships and associations, are not refunded for unused days",
      "A package cannot be transferred to another person or account",
      "Refunds are paid to the original payment method, through our payment provider's refund service, or by EFT into a bank account in your own name",
      "If a suspension is later overturned, we add the days lost to your paid slots and package",
      // C2: the first purchase.
      "if you ask us in writing within 5 business days after its payment is confirmed, we cancel your first purchase and refund it in full",
      // C3: VAT.
      "VerifyMzansi is not registered for VAT",
      // E6: the notice before a long term ends; nothing renews.
      "If a slot or package runs for 180 days or more, we email you about 60 business days before it ends",
      // E5, E7, E8, E2.
      "Not show an identifiable child in a post without the consent of the child's parent or guardian",
      "a non-exclusive, royalty-free licence to host, copy, resize, show and share your posts",
      "You confirm that you own what you post, or have the right to give us this licence",
      "liquor, tobacco and vaping products, medicines, loans and other financial products, and live animals and wildlife products",
      "Show your licence or registration number in the post when the law requires one",
      "Job ads that ask applicants to pay to apply or to get the job",
      "use Report on the post, or email abuse@verifymzansi.com with the post's link, what is wrong and how to contact you",
      "We act on a report within 2 business days and keep a record of every report",
      "on a credible complaint, and restrict the account that posted it",
    ])
      expect(text).toContain(rule);
    // No paid add-ons (not offered), never a partner commission figure, and
    // no tax invoice.
    expect(text).not.toMatch(/add-on|Urgent|Boost|Featured/);
    expect(text).not.toMatch(/%|per cent|percent/i);
    expect(text).not.toMatch(/tax invoice/i);
  });
});
