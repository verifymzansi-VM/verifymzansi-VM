import { describe, expect, it } from "vitest";
import { qrCode, qrCodeSvg } from "./qr-code";

describe("qrCode", () => {
  it("draws the text as dark squares on a square grid", () => {
    const { size, path } = qrCode("https://verifymzansi.com/?ref=THANDO1");
    expect(size).toBeGreaterThanOrEqual(29);
    expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });

  it("makes a stand-alone black-on-white SVG file", () => {
    const text = "https://verifymzansi.com/?ref=THANDO1";
    const { size, path } = qrCode(text);
    const svg = qrCodeSvg(text);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain(`<rect width="${size}" height="${size}" fill="#fff"/>`);
    expect(svg).toContain(`<path d="${path}" fill="#000"/>`);
    expect(svg).not.toContain("<script");
  });
});
