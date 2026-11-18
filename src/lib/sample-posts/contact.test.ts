import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSampleContact } from "./contact";

describe("VerifyMzansi's sample contact numbers", () => {
  it("is absent until a valid South African number is set", () => {
    expect(readSampleContact({})).toBeNull();
    expect(
      readSampleContact({ SAMPLE_CONTACT_PHONE: "", SAMPLE_CONTACT_WHATSAPP: " " })
    ).toBeNull();
    expect(readSampleContact({ SAMPLE_CONTACT_PHONE: "12345" })).toBeNull();
    expect(readSampleContact({ SAMPLE_CONTACT_WHATSAPP: "+44 20 7946 0958" })).toBeNull();
  });

  it("normalises each valid number and leaves out an invalid one", () => {
    expect(
      readSampleContact({ SAMPLE_CONTACT_PHONE: "082 123 4567", SAMPLE_CONTACT_WHATSAPP: "x" })
    ).toEqual({ phone: "+27821234567", whatsapp: null });
    expect(
      readSampleContact({
        SAMPLE_CONTACT_PHONE: "+27821234567",
        SAMPLE_CONTACT_WHATSAPP: "0821234568",
      })
    ).toEqual({ phone: "+27821234567", whatsapp: "+27821234568" });
  });
});

describe("wrangler.toml", () => {
  const toml = readFileSync(path.join(process.cwd(), "wrangler.toml"), "utf8");
  const values = (name: string) =>
    toml
      .split(/\r?\n/)
      .filter((line) => line.startsWith(`${name} = "`) && line.endsWith('"'))
      .map((line) => line.slice(name.length + 4, -1));

  it("gives every environment the same valid VerifyMzansi number", () => {
    for (const name of ["SAMPLE_CONTACT_PHONE", "SAMPLE_CONTACT_WHATSAPP"]) {
      expect(values(name)).toHaveLength(3);
      expect(new Set(values(name)).size).toBe(1);
    }
    expect(
      readSampleContact({
        SAMPLE_CONTACT_PHONE: values("SAMPLE_CONTACT_PHONE")[0],
        SAMPLE_CONTACT_WHATSAPP: values("SAMPLE_CONTACT_WHATSAPP")[0],
      })
    ).toEqual({ phone: "+27717484185", whatsapp: "+27717484185" });
  });

  it("keeps samples switched off everywhere", () => {
    expect(values("SAMPLE_POSTS_ENABLED")).toEqual(["false", "false", "false"]);
  });
});
