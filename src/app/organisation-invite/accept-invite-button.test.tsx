import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AcceptInviteButton } from "./accept-invite-button";
const { push, csrf } = vi.hoisted(() => ({ push: vi.fn(), csrf: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/utils/csrf", () => ({
  ensureCsrfTokenReady: csrf,
  withCsrfHeaders: (headers: HeadersInit) => new Headers(headers),
}));
const fetcher = vi.fn<typeof fetch>();
const token = "a".repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  csrf.mockResolvedValue("synthetic-csrf");
  fetcher.mockResolvedValue(Response.json({ organisation_slug: "local-chamber", role: "admin" }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
it("accepts through the native command and uses its validated organisation destination", async () => {
  render(<AcceptInviteButton token={token} organisationName="Local Chamber" foundation />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/organisation/local-chamber"));
  expect(fetcher).toHaveBeenCalledWith(
    "/api/foundation/organisations/invites/accept",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      body: JSON.stringify({ token }),
    })
  );
});
it("does not send an acceptance without CSRF readiness", async () => {
  csrf.mockResolvedValue(null);
  render(<AcceptInviteButton token={token} organisationName="Local Chamber" foundation />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(fetcher).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
it("shows the canonical refusal without granting UI access or navigating", async () => {
  fetcher.mockResolvedValue(
    Response.json({ error: "Complete identity verification first" }, { status: 403 })
  );
  render(<AcceptInviteButton token={token} organisationName="Local Chamber" foundation />);
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Complete identity verification first"
  );
  expect(push).not.toHaveBeenCalled();
});
it("refuses malformed success destinations rather than navigating away", async () => {
  fetcher.mockResolvedValue(Response.json({ organisation_slug: "../../admin" }));
  render(<AcceptInviteButton token={token} organisationName="Local Chamber" foundation />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert");
  expect(push).not.toHaveBeenCalled();
});
it("preserves the source fixture endpoint and response shape", async () => {
  fetcher.mockResolvedValue(Response.json({ data: { organisationSlug: "local-chamber" } }));
  render(<AcceptInviteButton token={token} organisationName="Local Chamber" />);
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/organisation/local-chamber"));
  expect(fetcher.mock.calls[0][0]).toBe("/api/organisations/invites/accept");
});
