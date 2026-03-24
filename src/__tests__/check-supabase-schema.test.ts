import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateClient = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

import {
  OWNER_COMPAT_TABLES,
  printSchemaVerificationResult,
  verifySupabaseSchema,
} from "../../scripts/check-supabase-schema";

describe("check-supabase-schema", () => {
  const originalEnv = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("reports legacy seller_id compatibility as a valid schema mode", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn((fields: string) => ({
          limit: vi.fn().mockResolvedValue(
            fields === "id, owner_id" && OWNER_COMPAT_TABLES.includes(table as never)
              ? {
                  error: {
                    code: "42703",
                    message: `column ${table}.owner_id does not exist`,
                  },
                }
              : { error: null }
          ),
        })),
      })),
    });

    const result = await verifySupabaseSchema({
      tables: OWNER_COMPAT_TABLES,
      legacyTables: [],
    });

    expect(result.ok).toBe(true);
    expect(result.ownerColumnChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "listings", mode: "seller_id", ok: true }),
        expect.objectContaining({ table: "businesses", mode: "seller_id", ok: true }),
        expect.objectContaining({ table: "promotions", mode: "seller_id", ok: true }),
      ])
    );
  });

  it("fails verification when a marketplace table has neither owner column", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn((fields: string) => ({
          limit: vi.fn().mockResolvedValue(
            table === "promotions" && (fields === "id, owner_id" || fields === "id, seller_id")
              ? {
                  error: {
                    code: "42703",
                    message: `column ${table}.${fields.split(", ")[1]} does not exist`,
                  },
                }
              : { error: null }
          ),
        })),
      })),
    });

    const result = await verifySupabaseSchema({
      tables: OWNER_COMPAT_TABLES,
      legacyTables: [],
    });

    expect(result.ok).toBe(false);
    expect(result.missingOwnerColumns).toEqual(["promotions"]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    printSchemaVerificationResult(result);
    expect(consoleSpy).toHaveBeenCalledWith("Ownership compatibility missing on: promotions");
    consoleSpy.mockRestore();
  });

  it("fails verification when legacy seller_profiles is still queryable", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    });

    const result = await verifySupabaseSchema({
      tables: ["account_profiles"],
      legacyTables: ["seller_profiles"],
    });

    expect(result.ok).toBe(false);
    expect(result.unexpectedLegacyTables).toEqual(["seller_profiles"]);
  });

  it("fails verification when account_profiles is missing required columns", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn((table: string) => ({
        select: vi.fn((fields: string) => ({
          limit: vi.fn().mockResolvedValue(
            table === "account_profiles" && fields.includes("account_verification_status")
              ? {
                  error: {
                    code: "42703",
                    message: "column account_profiles.account_verification_status does not exist",
                  },
                }
              : { error: { code: "PGRST205", message: "table not found" } }
          ),
        })),
      })),
    });

    const result = await verifySupabaseSchema({
      tables: ["account_profiles"],
      legacyTables: [],
    });

    expect(result.ok).toBe(false);
    expect(result.accountProfileColumnCheck).toEqual(
      expect.objectContaining({
        ok: false,
        errorCode: "42703",
      })
    );
  });
});
