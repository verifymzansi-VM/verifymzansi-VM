import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

function publicPath(src: string) {
  return join(process.cwd(), "public", src.split("?")[0]);
}

describe("web app manifest", () => {
  const m = manifest();

  it("identifies the app and keeps it scoped to the whole site", () => {
    expect(m).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
  });

  it("ships installable icons that exist on disk", () => {
    const icons = m.icons ?? [];
    expect(icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBe(true);
    expect(icons.some((i) => i.purpose === "any" && i.sizes === "512x512")).toBe(true);
    expect(icons.some((i) => i.purpose === "any" && i.sizes === "192x192")).toBe(true);
    for (const icon of icons) expect(existsSync(publicPath(icon.src)), icon.src).toBe(true);
  });

  it("keeps the install dialog to the icon, name and what installing does", () => {
    // Screenshots make Chrome show a large sheet of site pictures; the owner wants none.
    expect(m.screenshots).toBeUndefined();
    expect(m.description).toMatch(/home screen/);
    expect(m.description!.length).toBeLessThanOrEqual(140);
  });

  it("draws the shield inside the maskable safe zone, so launchers never clip it", async () => {
    const sharp = (await import("sharp")).default;
    const { info } = await sharp(publicPath("/icons/icon-maskable-512.png"))
      .trim()
      .toBuffer({ resolveWithObject: true });
    // Safe zone is a circle of 40% radius; the shield's box must also stay big enough to read.
    expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(512 * 0.76);
    expect(Math.max(info.width, info.height)).toBeGreaterThanOrEqual(512 * 0.7);
  });

  it("is the only manifest", () => {
    expect(existsSync(join(process.cwd(), "public", "manifest.json"))).toBe(false);
  });
});
