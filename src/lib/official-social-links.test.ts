import { describe, expect, it } from "vitest";
import { getOfficialSocialLinks, getOfficialSocialSameAs } from "./official-social-links";

describe("official social links", () => {
  it("returns only configured links in display order", () => {
    expect(
      getOfficialSocialLinks({
        linkedin: "https://linkedin.com/company/verifymzansi",
        facebook: "https://facebook.com/verifymzansi",
        x: "   ",
      })
    ).toEqual([
      {
        key: "facebook",
        label: "Facebook",
        href: "https://facebook.com/verifymzansi",
      },
      {
        key: "linkedin",
        label: "LinkedIn",
        href: "https://linkedin.com/company/verifymzansi",
      },
    ]);
  });

  it("builds sameAs from configured links only", () => {
    expect(
      getOfficialSocialSameAs({
        youtube: "https://youtube.com/@verifymzansi",
        tiktok: "https://tiktok.com/@verifymzansi",
      })
    ).toEqual(["https://youtube.com/@verifymzansi", "https://tiktok.com/@verifymzansi"]);
  });
});
