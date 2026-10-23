import { expect, it } from "vitest";
import { z } from "zod";

it.each(["array", "set", "map"] as const)(
  "rejects an oversized bounded %s before validating its elements",
  (collection) => {
    let visited = 0;
    const item = z.preprocess((value) => {
      visited++;
      return value;
    }, z.string());
    const values = Array.from({ length: 32 }, (_, i) => i);
    const result =
      collection === "array"
        ? z.array(item).max(2).safeParse(values)
        : collection === "set"
          ? z.set(item).max(2).safeParse(new Set(values))
          : z
              .map(z.string(), item)
              .max(2)
              .safeParse(new Map(values.map((i) => [String(i), i])));
    expect(result.success).toBe(false);
    expect(visited).toBe(0);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].code).toBe("too_big");
    }
  }
);
