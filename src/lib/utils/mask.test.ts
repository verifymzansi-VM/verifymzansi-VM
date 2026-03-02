import { describe, expect, it } from "vitest";
import { maskPhone, maskName, maskIdNumber, maskEmail } from "./mask";

describe("maskPhone", () => {
  it("masks +27 numbers", () => {
    expect(maskPhone("+27821234567")).toBe("+27 •••• ••67");
  });

  it("masks other numbers", () => {
    const result = maskPhone("0821234567");
    expect(result).toContain("67");
    expect(result).toContain("•");
  });

  it("handles very short input", () => {
    expect(maskPhone("12")).toBe("••••••••");
  });
});

describe("maskName", () => {
  it("masks surname to initial", () => {
    expect(maskName("Senzo Mthethwa")).toBe("Senzo M.");
  });

  it("masks single name for privacy", () => {
    expect(maskName("Senzo")).toBe("S***");
  });

  it("handles three-part names", () => {
    expect(maskName("John James Smith")).toBe("John S.");
  });
});

describe("maskIdNumber", () => {
  it("shows only last 4 digits", () => {
    expect(maskIdNumber("9001015800086")).toBe("••••••••• 0086");
  });

  it("handles short input", () => {
    expect(maskIdNumber("12")).toBe("•••••••••••••");
  });
});

describe("maskEmail", () => {
  it("masks the local part of email", () => {
    expect(maskEmail("senzo@example.com")).toBe("s***o@example.com");
  });

  it("handles single-char local", () => {
    expect(maskEmail("a@b.com")).toBe("***@b.com");
  });
});
