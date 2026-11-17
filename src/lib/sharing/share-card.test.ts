/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { parseShareCardInput } from "./share-card";

const card = {
  title: "Garden cottage",
  section: "Mzansi Market",
  price: "",
  location: "Richards Bay, KwaZulu-Natal",
  hasVideo: true,
};

describe("parseShareCardInput", () => {
  it("accepts the fields the share-preview route sends", () => {
    expect(parseShareCardInput(card)).toEqual({ ...card, poster: undefined });
    expect(
      parseShareCardInput({ ...card, poster: "https://media.verifymzansi.com/media/a.png" })
    ).toEqual({ ...card, poster: "https://media.verifymzansi.com/media/a.png" });
  });

  it.each([
    ["not an object", "card"],
    ["a list", [card]],
    ["a missing title", { ...card, title: undefined }],
    ["an overlong title", { ...card, title: "x".repeat(501) }],
    ["a non-boolean video flag", { ...card, hasVideo: "yes" }],
    ["a poster that is not a web address", { ...card, poster: "file:///etc/passwd" }],
    ["a poster that is not a URL", { ...card, poster: "not a url" }],
    ["an overlong poster", { ...card, poster: `https://a.test/${"x".repeat(2048)}` }],
  ])("refuses %s", (_case, value) => {
    expect(parseShareCardInput(value)).toBeNull();
  });
});
