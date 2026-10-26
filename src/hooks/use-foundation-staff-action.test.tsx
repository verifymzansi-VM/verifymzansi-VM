import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { useFoundationStaffAction } from "./use-foundation-staff-action";
import { ensureCsrfTokenReady } from "@/lib/utils/csrf";
const { state, refresh } = vi.hoisted(() => ({
  state: {
    value: {
      user: { id: "00000000-0000-4000-8000-000000000001" },
      foundationContext: { staff: { can_access: true } },
    },
  },
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: { getState: () => state.value } }));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: vi.fn(),
  withCsrfHeaders: (value: unknown) => value,
}));
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const command = {
  path: "/api/foundation/staff/partners",
  body: { action: "activate" },
  schema: z.strictObject({ id: z.uuid() }),
  successText: "Saved",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.value.user.id = owner;
  state.value.foundationContext.staff.can_access = true;
  vi.mocked(ensureCsrfTokenReady).mockResolvedValue("synthetic-csrf-token");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ account_id: owner, data: { id: owner } }))
  );
});
afterEach(() => vi.unstubAllGlobals());
it("saves only a correctly bound staff response", async () => {
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  await act(async () => {
    expect(await result.current.run(command)).toEqual({ id: owner });
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(result.current.message).toEqual({ tone: "success", text: "Saved" });
});
it("does not send when the visible account or staff authority has changed", async () => {
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  state.value.user.id = other;
  await act(async () => {
    expect(await result.current.run(command)).toBeUndefined();
  });
  state.value.user.id = owner;
  state.value.foundationContext.staff.can_access = false;
  await act(async () => {
    expect(await result.current.run(command)).toBeUndefined();
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(ensureCsrfTokenReady).not.toHaveBeenCalled();
});
it("checks the account again after asynchronous CSRF preparation", async () => {
  let release!: (value: string | null) => void;
  vi.mocked(ensureCsrfTokenReady).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.run(command);
  });
  state.value.user.id = other;
  await act(async () => {
    release("synthetic-csrf-token");
    await pending;
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.message).toBeNull();
});
it("ignores a late response after account switching", async () => {
  let release!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  let pending!: Promise<unknown>;
  act(() => {
    pending = result.current.run(command);
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  state.value.user.id = other;
  await act(async () => {
    release(Response.json({ account_id: owner, data: { id: owner } }));
    expect(await pending).toBeUndefined();
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.message).toBeNull();
});
it("refuses a response belonging to another caller", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ account_id: other, data: { id: other } }));
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  await act(async () => {
    expect(await result.current.run(command)).toBeUndefined();
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(result.current.message?.tone).toBe("error");
});
it("prevents duplicate submissions before React updates disabled buttons", async () => {
  let release!: (value: string | null) => void;
  vi.mocked(ensureCsrfTokenReady).mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const { result } = renderHook(() => useFoundationStaffAction(owner));
  let first!: Promise<unknown>;
  act(() => {
    first = result.current.run(command);
  });
  await act(async () => {
    expect(await result.current.run(command)).toBeUndefined();
    release("synthetic-csrf-token");
    await first;
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
