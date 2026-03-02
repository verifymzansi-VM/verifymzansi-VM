import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { buildSessionUser, deriveInitials } from "./session-user";

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as User;
}

describe("deriveInitials", () => {
  it("returns initials from full display name", () => {
    expect(deriveInitials("Jane Doe", "jane@example.com")).toBe("JD");
  });

  it("falls back to first two email characters when name is missing", () => {
    expect(deriveInitials("", "ab@example.com")).toBe("AB");
  });

  it("falls back to U when name and email are missing", () => {
    expect(deriveInitials("", "")).toBe("U");
  });
});

describe("buildSessionUser", () => {
  it("maps a non-anonymous user with metadata", () => {
    const mapped = buildSessionUser(
      createUser({
        email: "jane@example.com",
        user_metadata: { display_name: "Jane Doe" },
        app_metadata: { role: "admin" },
        is_anonymous: false,
      })
    );

    expect(mapped).toEqual({
      displayName: "Jane Doe",
      email: "jane@example.com",
      initials: "JD",
      role: "admin",
    });
  });

  it("maps an email-only user with safe defaults", () => {
    const mapped = buildSessionUser(
      createUser({
        email: "xy@example.com",
        user_metadata: {},
      })
    );

    expect(mapped).toEqual({
      displayName: "",
      email: "xy@example.com",
      initials: "XY",
      role: "",
    });
  });

  it("returns null for anonymous users and handles malformed metadata safely", () => {
    const anonymous = buildSessionUser(
      createUser({
        email: "anon@example.com",
        is_anonymous: true,
      })
    );
    expect(anonymous).toBeNull();

    expect(() =>
      buildSessionUser(
        createUser({
          user_metadata: "not-an-object" as unknown as User["user_metadata"],
          email: undefined,
        })
      )
    ).not.toThrow();
  });
});
