import { describe, expect, it } from "vitest";
import { normaliseTitle, scoreListingQuality } from "./score-listing";

const good = {
  title: "Samsung 55 inch Smart TV",
  description:
    "Two years old, works perfectly, comes with remote and wall bracket. Collection in Richards Bay or delivery nearby.",
  priceCents: 450000,
  priceExpected: true,
  category: "electronics",
  location: "Richards Bay",
  photos: [
    "https://media.verifymzansi.com/a.jpg",
    "https://media.verifymzansi.com/b.jpg",
    "https://media.verifymzansi.com/c.jpg",
  ],
};

describe("scoreListingQuality", () => {
  it("scores a complete listing highly with no issues", () => {
    expect(scoreListingQuality(good)).toEqual({ score: 100, issues: [] });
  });

  it("explains missing essentials instead of silently penalising", () => {
    const result = scoreListingQuality({
      title: "",
      description: "",
      priceExpected: true,
      photos: [],
    });
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "missing_title",
        "missing_description",
        "invalid_price",
        "missing_category",
        "missing_location",
        "no_photos",
      ])
    );
    expect(result.score).toBe(0);
    expect(result.issues.every((issue) => issue.message.length > 10)).toBe(true);
  });

  it("flags placeholders, duplicates, reused photos and scam wording for review", () => {
    const result = scoreListingQuality({
      ...good,
      description: `${good.description} Lorem ipsum. Pay a deposit to secure via Western Union.`,
      recentOwnerTitles: ["samsung 55-inch smart tv!"],
      ownerPhotoUrls: ["https://media.verifymzansi.com/a.jpg"],
    });
    const review = result.issues
      .filter((issue) => issue.severity === "review")
      .map((issue) => issue.code);
    expect(review).toEqual(
      expect.arrayContaining([
        "placeholder_content",
        "duplicate_listing",
        "reused_images",
        "suspicious_terms",
      ])
    );
  });

  it("flags implausible prices and contact details in text", () => {
    const low = scoreListingQuality({
      ...good,
      priceCents: 500,
      description: `${good.description} Call 082 123 4567`,
    });
    expect(low.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["suspicious_price", "contact_in_text"])
    );
  });

  it("sends prohibited-item wording to review without false positives", () => {
    const codes = (description: string) =>
      scoreListingQuality({ ...good, description }).issues.map((issue) => issue.code);
    expect(codes(`${good.description} Counterfeit sneakers available.`)).toContain(
      "prohibited_content"
    );
    expect(codes(`${good.description} Unlicensed pistol for sale.`)).toContain(
      "prohibited_content"
    );
    expect(codes(`${good.description} Ivory lace wedding dress, not stolen.`)).not.toContain(
      "prohibited_content"
    );
  });

  it("normalises titles for duplicate detection", () => {
    expect(normaliseTitle("  Samsung 55-inch  Smart TV! ")).toBe("samsung 55 inch smart tv");
  });
});
