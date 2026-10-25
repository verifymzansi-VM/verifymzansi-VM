import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";
import { useAuthStore } from "@/stores/auth-store";
import { FoundationAccountBoundary } from "./foundation-account-boundary";
const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const user = (id = first) => ({
  id,
  email: "test@example.invalid",
  displayName: "Member",
  role: "member",
});
beforeEach(() =>
  useAuthStore.setState({ user: user(), isLoading: false, foundationContext: null })
);
it("hides and discards cached server content immediately on a different account", () => {
  const reload = vi.fn();
  render(
    <FoundationAccountBoundary accountId={first} reload={reload}>
      <p>First account private data</p>
    </FoundationAccountBoundary>
  );
  expect(screen.getByText("First account private data")).toBeVisible();
  act(() => useAuthStore.setState({ user: user(second) }));
  expect(screen.queryByText("First account private data")).toBeNull();
  expect(reload).toHaveBeenCalledTimes(1);
});
it("preserves an unsaved draft across temporary session refresh for the same account", () => {
  render(
    <FoundationAccountBoundary>
      <input aria-label="Draft" defaultValue="" />
    </FoundationAccountBoundary>
  );
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Unsaved changes" } });
  act(() => useAuthStore.setState({ isLoading: true }));
  expect(screen.getByLabelText("Draft")).not.toBeVisible();
  act(() => useAuthStore.setState({ isLoading: false }));
  expect(screen.getByLabelText("Draft")).toBeVisible();
  expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved changes");
});
it("discards private content on sign out", () => {
  render(
    <FoundationAccountBoundary>
      <p>Private content</p>
    </FoundationAccountBoundary>
  );
  act(() => useAuthStore.getState().reset());
  expect(screen.queryByText("Private content")).toBeNull();
  expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
});
it("discards staff content as soon as current staff access is withdrawn", () => {
  useAuthStore.setState({
    foundationContext: { staff: { can_access: true } } as FoundationAccountContext,
  });
  render(
    <FoundationAccountBoundary accountId={first} staff>
      <p>Staff evidence</p>
    </FoundationAccountBoundary>
  );
  expect(screen.getByText("Staff evidence")).toBeVisible();
  act(() => useAuthStore.setState({ foundationContext: null }));
  expect(screen.queryByText("Staff evidence")).toBeNull();
  expect(screen.getByRole("link", { name: "Complete two-step verification" })).toBeVisible();
});
