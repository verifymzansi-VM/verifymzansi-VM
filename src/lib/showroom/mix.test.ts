import { describe, expect, it } from "vitest";
import { mixLocalFirst, type ShowroomEntry } from "./mix";

function entries(pattern: string): ShowroomEntry[] {
  return [...pattern].map((kind, index) => ({
    table: "businesses",
    id: `${kind}${index}`,
    isLocal: kind === "L",
  }));
}

describe("mixLocalFirst", () => {
  it("offers about 4 of 7 places to the visitor's province, starting local", () => {
    const mixed = mixLocalFirst(entries("NNNNNNNLLLLLLL"), "Gauteng").slice(0, 7);
    expect(mixed.map((entry) => (entry.isLocal ? "L" : "N")).join("")).toBe("LLNLNLN");
  });

  it("keeps each side in its ranked order", () => {
    const mixed = mixLocalFirst(entries("LNLNLN"), "Gauteng");
    expect(mixed.filter((entry) => entry.isLocal).map((entry) => entry.id)).toEqual([
      "L0",
      "L2",
      "L4",
    ]);
    expect(mixed.filter((entry) => !entry.isLocal).map((entry) => entry.id)).toEqual([
      "N1",
      "N3",
      "N5",
    ]);
  });

  it("fills from the rest of the country when a province has few posts", () => {
    const mixed = mixLocalFirst(entries("NNNNNNL"), "Northern Cape");
    expect(mixed).toHaveLength(7);
    expect(mixed[0].isLocal).toBe(true);
  });

  it("keeps the fair ranking unchanged without a province", () => {
    const list = entries("NLNL");
    expect(mixLocalFirst(list, null)).toBe(list);
  });
});
