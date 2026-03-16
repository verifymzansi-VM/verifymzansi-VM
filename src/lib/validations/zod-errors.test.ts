import { describe, it, expect } from "vitest";
import { toFieldErrorMap } from "./zod-errors";
import { z } from "zod";

describe("toFieldErrorMap", () => {
  it("maps zod errors to field paths", () => {
    const schema = z.object({ name: z.string().min(1), age: z.number() });
    const result = schema.safeParse({ name: "", age: "not-a-number" });
    if (result.success) throw new Error("Expected failure");
    const map = toFieldErrorMap(result.error);
    expect(map).toHaveProperty("name");
    expect(map).toHaveProperty("age");
  });

  it("keeps first error per field", () => {
    const schema = z.object({ name: z.string().min(2).max(3) });
    const result = schema.safeParse({ name: "" });
    if (result.success) throw new Error("Expected failure");
    const map = toFieldErrorMap(result.error);
    expect(typeof map.name).toBe("string");
  });

  it("returns empty map when no issues", () => {
    const error = { issues: [] } as unknown as z.ZodError;
    expect(toFieldErrorMap(error)).toEqual({});
  });

  it("handles nested paths", () => {
    const schema = z.object({ address: z.object({ city: z.string().min(1) }) });
    const result = schema.safeParse({ address: { city: "" } });
    if (result.success) throw new Error("Expected failure");
    const map = toFieldErrorMap(result.error);
    expect(map).toHaveProperty("address.city");
  });
});
