import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/utils/enum-compat", () => ({
  mapListingCategory: vi.fn((c: string) => c),
}));

import { registerCommand, registerQuery, executeCommand, executeQuery } from "./index";

describe("CQRS module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Command registration & execution ────────────────────

  describe("executeCommand", () => {
    it("returns error for unknown command", async () => {
      const result = await executeCommand(
        "nonexistent.command",
        {},
        {
          userId: "u1",
          userRole: "member",
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown command");
    });

    it("executes a registered command successfully", async () => {
      registerCommand<{ value: number }, { doubled: number }>("test.double", async (input) => ({
        success: true,
        data: { doubled: input.value * 2 },
      }));

      const result = await executeCommand(
        "test.double",
        { value: 5 },
        {
          userId: "u1",
          userRole: "admin",
        }
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ doubled: 10 });
    });

    it("catches thrown errors in command handler", async () => {
      registerCommand("test.throws", async () => {
        throw new Error("handler boom");
      });

      const result = await executeCommand(
        "test.throws",
        {},
        {
          userId: "u1",
          userRole: "member",
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("handler boom");
    });

    it("handles non-Error throws in command handler", async () => {
      registerCommand("test.throws-string", async () => {
        throw "string error";
      });

      const result = await executeCommand(
        "test.throws-string",
        {},
        {
          userId: "u1",
          userRole: "member",
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Command execution failed");
    });

    it("passes context to handler", async () => {
      const spy = vi.fn().mockResolvedValue({ success: true });
      registerCommand("test.ctx", spy);

      await executeCommand(
        "test.ctx",
        { x: 1 },
        {
          userId: "user-42",
          userRole: "admin",
        }
      );

      expect(spy).toHaveBeenCalledWith({ x: 1 }, { userId: "user-42", userRole: "admin" });
    });
  });

  // ── Query registration & execution ──────────────────────

  describe("executeQuery", () => {
    it("returns error for unknown query", async () => {
      const result = await executeQuery("nonexistent.query", {});
      expect(result.data).toBeNull();
      expect(result.error).toContain("Unknown query");
    });

    it("executes a registered query successfully", async () => {
      registerQuery<{ id: string }, { name: string }>("test.getById", async (input) => ({
        data: { name: `item-${input.id}` },
      }));

      const result = await executeQuery("test.getById", { id: "42" });
      expect(result.data).toEqual({ name: "item-42" });
      expect(result.error).toBeUndefined();
    });

    it("catches thrown errors in query handler", async () => {
      registerQuery("test.query-throws", async () => {
        throw new Error("query boom");
      });

      const result = await executeQuery("test.query-throws", {});
      expect(result.data).toBeNull();
      expect(result.error).toBe("query boom");
    });

    it("handles non-Error throws in query handler", async () => {
      registerQuery("test.query-throws-obj", async () => {
        throw 42;
      });

      const result = await executeQuery("test.query-throws-obj", {});
      expect(result.data).toBeNull();
      expect(result.error).toBe("Query execution failed");
    });

    it("defaults context to empty object", async () => {
      const spy = vi.fn().mockResolvedValue({ data: null });
      registerQuery("test.query-ctx", spy);

      await executeQuery("test.query-ctx", { a: 1 });
      expect(spy).toHaveBeenCalledWith({ a: 1 }, {});
    });

    it("passes explicit context when provided", async () => {
      const spy = vi.fn().mockResolvedValue({ data: null });
      registerQuery("test.query-ctx2", spy);

      await executeQuery("test.query-ctx2", {}, { userId: "u1" });
      expect(spy).toHaveBeenCalledWith({}, { userId: "u1" });
    });
  });
});
