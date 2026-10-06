import { describe, expect, it } from "vitest";

import { maskIdNumbers } from "./intake";
import { publicOffice, toPublicVerification } from "./public";

const office = {
  streetLines: ["12 Main Road"],
  suburb: "KwaDlangezwa",
  city: "Empangeni",
  province: "KwaZulu-Natal",
  postalCode: "3886",
};

describe("publicOffice", () => {
  it("keeps the street and postal code only when the owner shows them", () => {
    expect(publicOffice(office, false)).toEqual({
      suburb: "KwaDlangezwa",
      city: "Empangeni",
      province: "KwaZulu-Natal",
    });
    expect(publicOffice(office, true)).toMatchObject({
      streetLines: ["12 Main Road"],
      postalCode: "3886",
    });
    expect(publicOffice(null, true)).toBeNull();
  });
});

describe("toPublicVerification", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  it("hides expired stickers before the daily job clears them", () => {
    const row = toPublicVerification({
      cipc_verified_at: past,
      cipc_expires_at: past,
      cipc_registered_office: office,
      owner_position_title: "Director",
      seen_verified_at: past,
      seen_expires_at: past,
      seen_city: "Empangeni",
    });
    expect(row).toMatchObject({
      cipc_verified_at: null,
      cipc_registered_office: null,
      owner_position_title: null,
      seen_verified_at: null,
      seen_city: null,
    });
  });

  it("drops hidden street lines from a live sticker", () => {
    const row = toPublicVerification({
      cipc_verified_at: past,
      cipc_expires_at: future,
      cipc_registered_office: office,
      show_full_registered_office: false,
    });
    expect(row.cipc_registered_office).toEqual({
      suburb: "KwaDlangezwa",
      city: "Empangeni",
      province: "KwaZulu-Natal",
    });
  });
});

describe("maskIdNumbers", () => {
  it("masks 13-digit SA ID numbers, spaced or not, and nothing else", () => {
    expect(maskIdNumbers("THANDO 8001015009087 Director")).toBe("THANDO [ID number] Director");
    expect(maskIdNumbers("ID 800101 5009 087.")).toBe("ID [ID number].");
    expect(maskIdNumbers("Reg 2020/123456/07, tel 0831234567")).toBe(
      "Reg 2020/123456/07, tel 0831234567"
    );
  });
});
