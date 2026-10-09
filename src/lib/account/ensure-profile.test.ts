import { describe, it, expect, vi } from "vitest";
import {
  ensureAccountProfile,
  getDefaultDisplayName,
  resolveAccountDisplayName,
} from "./ensure-profile";

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type MockAdmin = {
  from: ReturnType<typeof vi.fn>;
};

function buildAdminClient(options: {
  existingProfile?: { id: string; display_name: string | null } | null;
  repairedProfile?: { id: string; display_name: string } | null;
  createdProfile?: { id: string; display_name: string } | null;
  repairError?: { message?: string } | null;
  createError?: { message?: string } | null;
}): {
  admin: MockAdmin;
  calls: {
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
} {
  let mode: "lookup" | "update" | "upsert" = "lookup";
  const update = vi.fn();
  const upsert = vi.fn();
  const insert = vi.fn();

  const builder = {
    select: vi.fn((_fields: string) => {
      if (mode === "lookup") {
        return {
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: options.existingProfile ?? null,
            error: null,
          }),
        };
      }

      return {
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data:
            mode === "update"
              ? (options.repairedProfile ?? null)
              : (options.createdProfile ?? null),
          error: mode === "update" ? (options.repairError ?? null) : (options.createError ?? null),
        }),
      };
    }),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    update: update.mockImplementation(() => {
      mode = "update";
      return builder;
    }),
    upsert: upsert.mockImplementation(() => {
      mode = "upsert";
      return builder;
    }),
    insert: insert.mockImplementation(() => {
      mode = "upsert";
      return builder;
    }),
  };

  const admin = {
    from: vi.fn(() => builder),
  };

  return {
    admin,
    calls: {
      update,
      upsert,
      insert,
    },
  };
}

describe("ensure-profile", () => {
  function recoveryClient(lookups: Array<{ data: unknown; error: unknown }>) {
    const maybeSingle = vi.fn();
    for (const result of lookups) maybeSingle.mockResolvedValueOnce(result);
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: "23505", message: "duplicate profile" },
        }),
      }),
    });
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "existing", display_name: "Replacement" },
          error: null,
        }),
      }),
    });
    const update = vi.fn();
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
        insert,
        upsert,
        update,
      }),
    };
    return { admin, insert, upsert, update, maybeSingle };
  }

  it("never resets an existing account after a failed profile lookup", async () => {
    const { admin, insert, upsert, update } = recoveryClient([
      { data: null, error: { message: "read unavailable" } },
    ]);
    expect(await ensureAccountProfile(admin, { id: "user-1" })).toBeNull();
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("re-reads a concurrent creation without replacing its account defaults", async () => {
    const existing = {
      id: "profile-1",
      display_name: "Verified Name",
      account_status: "suspended",
      account_verification_status: "verified",
    };
    const { admin, insert, upsert, update } = recoveryClient([
      { data: null, error: null },
      { data: existing, error: null },
    ]);
    expect(
      await ensureAccountProfile(admin, {
        id: "user-1",
        user_metadata: { display_name: "Replacement" },
      })
    ).toEqual({ id: "profile-1", display_name: "Verified Name" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(existing).toMatchObject({
      account_status: "suspended",
      account_verification_status: "verified",
    });
  });

  it.each([
    { data: null, error: { message: "retry read unavailable" } },
    { data: null, error: null },
  ])("stops a creation race safely when re-reading fails: %j", async (result) => {
    const { admin, insert, upsert, maybeSingle } = recoveryClient([
      { data: null, error: null },
      result,
    ]);
    expect(await ensureAccountProfile(admin, { id: "user-1" })).toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("derives default display name from metadata before email", () => {
    expect(
      getDefaultDisplayName({
        email: "member@example.com",
        user_metadata: { display_name: "  Siya  " },
      })
    ).toBe("Siya");

    expect(
      getDefaultDisplayName({
        email: "member@example.com",
        user_metadata: { full_name: "  Siya Khumalo  " },
      })
    ).toBe("Siya Khumalo");

    expect(
      getDefaultDisplayName({
        email: "member@example.com",
        user_metadata: { name: "  Google Member  " },
      })
    ).toBe("Google Member");

    expect(
      getDefaultDisplayName({
        email: "member@example.com",
        user_metadata: { given_name: "Siya", family_name: "Khumalo" },
      })
    ).toBe("Siya Khumalo");

    expect(
      getDefaultDisplayName({
        email: "member@example.com",
        user_metadata: {},
      })
    ).toBe("member");
  });

  it("resolves account display name using profile first", () => {
    expect(
      resolveAccountDisplayName({
        profileDisplayName: "  Verified Seller  ",
        email: "fallback@example.com",
        user_metadata: { display_name: "Fallback" },
      })
    ).toBe("Verified Seller");
  });

  it("returns existing profile when display_name is present", async () => {
    const { admin, calls } = buildAdminClient({
      existingProfile: { id: "profile-1", display_name: "Current Name" },
    });

    const result = await ensureAccountProfile(admin as never, {
      id: "user-1",
      email: "user@example.com",
      user_metadata: { display_name: "Meta Name" },
    });

    expect(result).toEqual({ id: "profile-1", display_name: "Current Name" });
    expect(calls.update).not.toHaveBeenCalled();
    expect(calls.upsert).not.toHaveBeenCalled();
  });

  it("repairs existing profile when display_name is missing", async () => {
    const { admin, calls } = buildAdminClient({
      existingProfile: { id: "profile-1", display_name: null },
      repairedProfile: { id: "profile-1", display_name: "Meta Name" },
    });

    const result = await ensureAccountProfile(admin as never, {
      id: "user-1",
      email: "user@example.com",
      user_metadata: { display_name: "Meta Name" },
    });

    expect(result).toEqual({ id: "profile-1", display_name: "Meta Name" });
    expect(calls.update).toHaveBeenCalledWith({ display_name: "Meta Name" });
    expect(calls.upsert).not.toHaveBeenCalled();
  });

  it('repairs existing profile when display_name is the placeholder "New Member"', async () => {
    const { admin, calls } = buildAdminClient({
      existingProfile: { id: "profile-1", display_name: "New Member" },
      repairedProfile: { id: "profile-1", display_name: "Google Name" },
    });

    const result = await ensureAccountProfile(admin as never, {
      id: "user-1",
      email: "user@example.com",
      user_metadata: { name: "Google Name" },
    });

    expect(result).toEqual({ id: "profile-1", display_name: "Google Name" });
    expect(calls.update).toHaveBeenCalledWith({ display_name: "Google Name" });
  });

  it("creates profile when missing", async () => {
    const { admin, calls } = buildAdminClient({
      existingProfile: null,
      createdProfile: { id: "profile-2", display_name: "Nomsa" },
    });

    const result = await ensureAccountProfile(admin as never, {
      id: "user-2",
      email: "nomsa@example.com",
      user_metadata: { display_name: "Nomsa" },
    });

    expect(result).toEqual({ id: "profile-2", display_name: "Nomsa" });
    expect(calls.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-2" }));
    expect(calls.upsert).not.toHaveBeenCalled();
  });

  it("returns null when repair fails", async () => {
    const { admin } = buildAdminClient({
      existingProfile: { id: "profile-1", display_name: null },
      repairedProfile: null,
      repairError: { message: "repair failed" },
    });

    const result = await ensureAccountProfile(admin as never, {
      id: "user-1",
      email: "user@example.com",
      user_metadata: { display_name: "Meta Name" },
    });

    expect(result).toBeNull();
  });
});
