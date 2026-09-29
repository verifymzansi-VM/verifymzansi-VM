import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockCheckRateLimit, mockQueuePublicMediaCleanup } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
    mockQueuePublicMediaCleanup: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/services/media-cleanup", () => ({
  queuePublicMediaCleanup: mockQueuePublicMediaCleanup,
}));

import { POST } from "./route";

const CSRF_TOKEN = "a".repeat(64);

function createRequest(body: unknown, headers: Record<string, string> = {}) {
  const mergedHeaders: Record<string, string> = {
    origin: "http://localhost:3000",
    cookie: `vm_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    ...Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    ),
  };

  return {
    method: "POST",
    json: async () => body,
    url: "http://localhost:3000/api/account/delete",
    nextUrl: new URL("http://localhost:3000/api/account/delete"),
    headers: {
      get(name: string) {
        return mergedHeaders[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

type MockError = { code?: string; message?: string } | null;

type RecordedMutation = {
  table: string;
  op: "update" | "delete";
  payload?: unknown;
  filter: [string, unknown];
};

function createAdminClientMock(
  options: {
    legalHold?: boolean;
    cleanupError?: MockError;
    deleteUserError?: { message: string } | null;
    staffRole?: string | null;
    redactError?: { message: string } | null;
    mediaUploads?: Array<{ url: string }>;
    mediaUploadsError?: { message: string } | null;
    avatarFiles?: Array<{ name: string }>;
    avatarListError?: { message: string } | null;
    avatarRemoveError?: { message: string } | null;
  } = {}
) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "staff_access_of") {
      return {
        data: options.staffRole ? [{ role: options.staffRole, mfa_required_after: null }] : [],
        error: null,
      };
    }
    return { data: 0, error: options.redactError ?? null };
  });
  const deleteUser = vi.fn().mockResolvedValue({ error: options.deleteUserError ?? null });

  // Every cleanup mutation is recorded; the first update fails when cleanupError is set.
  const mutations: RecordedMutation[] = [];
  const recordMutation = (table: string, op: RecordedMutation["op"], payload?: unknown) => ({
    eq: vi.fn(async (column: string, value: unknown) => {
      const isFirstUpdate = op === "update" && !mutations.some((m) => m.op === "update");
      mutations.push({ table, op, payload, filter: [column, value] });
      return { error: isFirstUpdate ? (options.cleanupError ?? null) : null };
    }),
  });

  const mediaUploadsEq = vi.fn().mockResolvedValue({
    data: options.mediaUploads ?? [],
    error: options.mediaUploadsError ?? null,
  });
  const mediaUploadsSelect = vi.fn().mockReturnValue({ eq: mediaUploadsEq });

  const from = vi.fn((table: string) => {
    if (table === "account_profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { legal_hold: options.legalHold ?? false },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "media_uploads") {
      return { select: mediaUploadsSelect };
    }

    return {
      delete: vi.fn(() => recordMutation(table, "delete")),
      update: vi.fn((payload: unknown) => recordMutation(table, "update", payload)),
    };
  });

  const avatarList = vi.fn().mockResolvedValue({
    data: options.avatarFiles ?? [],
    error: options.avatarListError ?? null,
  });
  const avatarRemove = vi.fn().mockResolvedValue({
    data: [],
    error: options.avatarRemoveError ?? null,
  });
  const storageFrom = vi.fn().mockReturnValue({ list: avatarList, remove: avatarRemove });

  const admin = {
    from,
    rpc,
    storage: { from: storageFrom },
    auth: {
      admin: { deleteUser },
    },
  };
  mockCreateAdminClient.mockReturnValue(admin);
  return {
    admin,
    deleteUser,
    rpc,
    mutations,
    mediaUploadsSelect,
    mediaUploadsEq,
    storageFrom,
    avatarList,
    avatarRemove,
  };
}

const GOOGLE_USER = {
  id: "user-1",
  email: "user@gmail.com",
  identities: [{ provider: "google" }],
  app_metadata: { provider: "google" },
};

function createSupabaseClientMock(user: unknown, options: { passwordError?: boolean } = {}) {
  const signInWithPassword = vi
    .fn()
    .mockResolvedValue({ error: options.passwordError ? { message: "bad password" } : null });
  const signOut = vi.fn().mockResolvedValue({ error: null });
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signInWithPassword,
      signOut,
    },
  });
  return { signInWithPassword, signOut };
}

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockQueuePublicMediaCleanup.mockResolvedValue([]);
    createAdminClientMock();
  });

  it("rejects unauthenticated requests", async () => {
    createSupabaseClientMock(null);

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(401);
  });

  it("rejects cross-site requests before auth or cleanup", async () => {
    const res = await POST(
      createRequest({ confirmation: "DELETE" }, { origin: "https://evil.example" })
    );

    expect(res.status).toBe(403);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("rejects requests without a CSRF token", async () => {
    const res = await POST(
      createRequest(
        { confirmation: "DELETE" },
        {
          cookie: "",
          "x-csrf-token": "",
        }
      )
    );

    expect(res.status).toBe(403);
  });

  it("requires DELETE confirmation", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@example.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });

    const res = await POST(createRequest({ confirmation: "nope" }));

    expect(res.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({ limited: true, degraded: false, retryAfter: 30 });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("requires current password for password accounts", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@example.com",
      identities: [{ provider: "email" }],
      app_metadata: { provider: "email" },
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "PASSWORD_REQUIRED" });
  });

  it("rejects an incorrect password for password accounts", async () => {
    const { signInWithPassword } = createSupabaseClientMock(
      {
        id: "user-1",
        email: "user@example.com",
        identities: [{ provider: "email" }],
        app_metadata: { provider: "email" },
      },
      { passwordError: true }
    );

    const res = await POST(
      createRequest({ confirmation: "DELETE", currentPassword: "wrong-password" })
    );

    expect(res.status).toBe(401);
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "wrong-password",
    });
  });

  it("allows Google-only authenticated deletion without a password", async () => {
    const { signInWithPassword, signOut } = createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { admin, deleteUser } = createAdminClientMock();

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(200);
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledWith("consent_records");
    expect(admin.from).toHaveBeenCalledWith("content_edit_requests");
    // The audit trail and decision ledger are kept and redacted, not deleted.
    for (const kept of [
      "audit_logs",
      "decision_records",
      "decision_record_events",
      "appeal_cases",
      "role_assignments_history",
      "moderation_actions",
    ]) {
      expect(admin.from).not.toHaveBeenCalledWith(kept);
    }
    expect(admin.rpc).toHaveBeenCalledWith("redact_personal_audit_data", {
      p_user: "user-1",
      p_reason: "Account deleted by the account holder",
    });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(signOut).toHaveBeenCalled();
  });

  it("keeps KYC evidence access logs where the user was the actor, clearing only actor_id", async () => {
    createSupabaseClientMock(GOOGLE_USER);
    const { mutations } = createAdminClientMock();

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(200);
    expect(mutations).toContainEqual({
      table: "kyc_evidence_access_logs",
      op: "update",
      payload: { actor_id: null },
      filter: ["actor_id", "user-1"],
    });
    // Rows about the user's own evidence are still removed.
    expect(mutations).toContainEqual({
      table: "kyc_evidence_access_logs",
      op: "delete",
      payload: undefined,
      filter: ["user_id", "user-1"],
    });
    expect(mutations).not.toContainEqual(
      expect.objectContaining({
        table: "kyc_evidence_access_logs",
        op: "delete",
        filter: ["actor_id", "user-1"],
      })
    );
  });

  it("removes the user's stored media and avatar files before deleting the auth user", async () => {
    createSupabaseClientMock(GOOGLE_USER);
    const uploadUrl = "https://media.example.com/uploads/user-1/photo.jpg";
    const mocks = createAdminClientMock({
      mediaUploads: [{ url: uploadUrl }],
      avatarFiles: [{ name: "avatar.jpg" }, { name: "avatar.png" }],
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(200);
    expect(mocks.admin.from).toHaveBeenCalledWith("media_uploads");
    expect(mocks.mediaUploadsSelect).toHaveBeenCalledWith("url");
    expect(mocks.mediaUploadsEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(mockQueuePublicMediaCleanup).toHaveBeenCalledWith(
      mocks.admin,
      [uploadUrl],
      "account_deleted",
      "user-1"
    );
    expect(mocks.storageFrom).toHaveBeenCalledWith("avatars");
    expect(mocks.avatarList).toHaveBeenCalledWith("user-1");
    expect(mocks.avatarRemove).toHaveBeenCalledWith(["user-1/avatar.jpg", "user-1/avatar.png"]);

    const deleteOrder = mocks.deleteUser.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeDefined();
    expect(mockQueuePublicMediaCleanup.mock.invocationCallOrder[0]).toBeLessThan(deleteOrder);
    expect(mocks.avatarRemove.mock.invocationCallOrder[0]).toBeLessThan(deleteOrder);
  });

  it("skips media queueing and avatar removal when the user has no stored files", async () => {
    createSupabaseClientMock(GOOGLE_USER);
    const { deleteUser, avatarList, avatarRemove } = createAdminClientMock();

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(200);
    expect(mockQueuePublicMediaCleanup).not.toHaveBeenCalled();
    expect(avatarList).toHaveBeenCalledWith("user-1");
    expect(avatarRemove).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it.each<[string, Parameters<typeof createAdminClientMock>[0], boolean]>([
    ["the media_uploads lookup fails", { mediaUploadsError: { message: "db down" } }, false],
    ["media cleanup queueing fails", { mediaUploads: [{ url: "https://x.example/y.jpg" }] }, true],
    ["avatar listing fails", { avatarListError: { message: "storage down" } }, false],
    [
      "avatar removal fails",
      { avatarFiles: [{ name: "avatar.jpg" }], avatarRemoveError: { message: "storage down" } },
      false,
    ],
  ])("returns 500 and keeps the auth user when %s", async (_label, options, queueFails) => {
    createSupabaseClientMock(GOOGLE_USER);
    if (queueFails) {
      mockQueuePublicMediaCleanup.mockRejectedValueOnce(new Error("queue insert failed"));
    }
    const { deleteUser } = createAdminClientMock(options);

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: "Unable to delete account right now",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("blocks legal-hold accounts", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({ legalHold: true });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(409);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 500 if cleanup fails and does not delete auth user", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({
      cleanupError: { code: "500", message: "cleanup failed" },
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("returns 500 if Supabase auth deletion fails", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({
      deleteUserError: { message: "delete failed" },
    });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
    // Reached the auth deletion itself rather than failing earlier.
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("keeps staff accounts until their role is removed", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "admin@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({ staffRole: "admin" });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "STAFF_ROLE_ACTIVE" });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete the account if the audit redaction fails", async () => {
    createSupabaseClientMock({
      id: "user-1",
      email: "user@gmail.com",
      identities: [{ provider: "google" }],
      app_metadata: { provider: "google" },
    });
    const { deleteUser } = createAdminClientMock({ redactError: { message: "db down" } });

    const res = await POST(createRequest({ confirmation: "DELETE" }));

    expect(res.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
