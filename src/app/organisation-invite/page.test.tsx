import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
import { FoundationServerSessionError } from "@/lib/foundation/server-session";

const { preview, session, legacy, accept } = vi.hoisted(() => ({
  preview: vi.fn(),
  session: vi.fn(),
  legacy: vi.fn(),
  accept: vi.fn(),
}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: legacy }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: legacy }));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/organisations", () => ({ previewFoundationOrganisationInvite: preview }));
vi.mock("@/lib/foundation/server-session", () => ({
  readFoundationServerSession: session,
  FoundationServerSessionError: class extends Error {
    constructor(readonly status: number) {
      super("Session unavailable");
    }
  },
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("./accept-invite-button", () => ({
  AcceptInviteButton: (props: unknown) => {
    accept(props);
    return <button>Accept invitation</button>;
  },
}));
const token = "a".repeat(43);
beforeEach(() => {
  vi.clearAllMocks();
  preview.mockResolvedValue({
    organisation_name: "Local Chamber",
    email: "t***@example.invalid",
    expires_at: "2026-11-01T10:00:00Z",
    status: "open",
  });
  session.mockResolvedValue({
    account: { email: "thando@example.invalid", profile: { identity_verified: true } },
  });
});

it("uses the masked native preview and current account context rather than source tables", async () => {
  render(await Page({ searchParams: Promise.resolve({ token }) }));
  expect(screen.getByRole("heading", { name: "Manage Local Chamber" })).toBeInTheDocument();
  expect(preview).toHaveBeenCalledWith({}, { token });
  expect(accept).toHaveBeenCalledWith({
    token,
    organisationName: "Local Chamber",
    foundation: true,
  });
  expect(legacy).not.toHaveBeenCalled();
});
it("offers sign-in to an anonymous invitee without revealing an unmasked address", async () => {
  session.mockRejectedValue(new FoundationServerSessionError(401));
  render(await Page({ searchParams: Promise.resolve({ token }) }));
  expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    expect.stringContaining("returnUrl=")
  );
  expect(screen.queryByText("thando@example.invalid")).not.toBeInTheDocument();
  expect(accept).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
});
it("requires the verified native identity before showing the acceptance control", async () => {
  session.mockResolvedValue({
    account: { email: "thando@example.invalid", profile: { identity_verified: false } },
  });
  render(await Page({ searchParams: Promise.resolve({ token }) }));
  expect(screen.getByRole("link", { name: "Complete identity review" })).toHaveAttribute(
    "href",
    "/verification"
  );
  expect(accept).not.toHaveBeenCalled();
});
it("rejects malformed tokens before any session or database request", async () => {
  render(await Page({ searchParams: Promise.resolve({ token: "invalid" }) }));
  expect(screen.getByText(/invitation link is not valid/)).toBeInTheDocument();
  expect(preview).not.toHaveBeenCalled();
  expect(session).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
});
it("shows revoked status without querying a session or offering acceptance", async () => {
  preview.mockResolvedValue({
    organisation_name: "Local Chamber",
    email: "t***@example.invalid",
    expires_at: "2026-11-01T10:00:00Z",
    status: "revoked",
  });
  render(await Page({ searchParams: Promise.resolve({ token }) }));
  expect(screen.getByText(/replaced or withdrawn/)).toBeInTheDocument();
  expect(session).not.toHaveBeenCalled();
  expect(accept).not.toHaveBeenCalled();
});
it("does not turn a session outage into anonymous or verified access", async () => {
  session.mockRejectedValue(new FoundationServerSessionError(503));
  await expect(Page({ searchParams: Promise.resolve({ token }) })).rejects.toMatchObject({
    status: 503,
  });
  expect(accept).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
});
