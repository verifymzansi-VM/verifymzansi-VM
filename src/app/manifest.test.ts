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

  it("has narrow and wide screenshots that exist on disk", () => {
    const shots = m.screenshots ?? [];
    expect(shots.some((s) => s.form_factor === "narrow")).toBe(true);
    expect(shots.some((s) => s.form_factor === "wide")).toBe(true);
    for (const shot of shots) expect(existsSync(publicPath(shot.src)), shot.src).toBe(true);
  });

  it("is the only manifest", () => {
    expect(existsSync(join(process.cwd(), "public", "manifest.json"))).toBe(false);
  });
});
