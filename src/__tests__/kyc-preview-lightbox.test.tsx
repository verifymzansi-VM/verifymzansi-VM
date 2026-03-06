/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode; variant?: string; className?: string }) => (
    <span data-testid="badge">{children}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
    asChild?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement> & { children: React.ReactNode }) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockCreateObjectURL = vi.fn(() => "blob:mock-lightbox-url");
const mockRevokeObjectURL = vi.fn();

const OriginalURL = globalThis.URL;
Object.defineProperty(OriginalURL, "createObjectURL", {
  value: mockCreateObjectURL,
  writable: true,
});
Object.defineProperty(OriginalURL, "revokeObjectURL", {
  value: mockRevokeObjectURL,
  writable: true,
});

const { KycPreviewLightbox } = await import("@/components/admin/kyc-preview-lightbox");

// ── Test data ────────────────────────────────────────────────

const MOCK_STEP = {
  id: "step-1",
  user_id: "user-1",
  step_type: "id_doc",
  status: "pending",
  created_at: "2025-01-01T00:00:00Z",
  seller_display_name: "Test Seller",
  seller_verification_status: "pending",
};

const MOCK_ARTIFACT = {
  id: "art-1",
  step_type: "id_doc",
  artifact_kind: "document",
  r2_key: "kyc/test/id.jpg",
  content_type: "image/jpeg",
  file_size_bytes: 150_000,
  status: "encrypted",
  created_at: "2025-01-01T00:00:00Z",
  purge_after: null,
  sha256: "abc123",
};

async function renderOpenLightbox(
  props: Partial<React.ComponentProps<typeof KycPreviewLightbox>> = {}
) {
  await act(async () => {
    render(
      <KycPreviewLightbox
        open={true}
        onOpenChange={vi.fn()}
        step={MOCK_STEP}
        artifact={MOCK_ARTIFACT}
        {...props}
      />
    );
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("KycPreviewLightbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when open is false", () => {
    render(
      <KycPreviewLightbox
        open={false}
        onOpenChange={vi.fn()}
        step={MOCK_STEP}
        artifact={MOCK_ARTIFACT}
      />
    );

    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("renders and fetches blob when open is true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    expect(screen.getByTestId("dialog")).toBeDefined();
    expect(screen.getByText(/document preview/i)).toBeDefined();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("artifactId=art-1"));
    });

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });
  });

  it("shows seller name and step type in header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    expect(screen.getByText("Test Seller")).toBeDefined();
    expect(screen.getByText("ID Document")).toBeDefined();
  });

  it("displays Approve, Reject, and Resubmit buttons", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
      expect(screen.getByText("Reject")).toBeDefined();
      expect(screen.getByText("Resubmit")).toBeDefined();
    });
  });

  it("shows decision form when Approve is clicked", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Approve")).toBeDefined();
      expect(screen.getByText(/this will mark the step as approved/i)).toBeDefined();
    });
  });

  it("shows reason code select when Reject is clicked", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByText("Reject")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Reject"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Reject")).toBeDefined();
      expect(screen.getByTitle("Reason code")).toBeDefined();
    });
  });

  it("submits approval decision and calls onDecisionComplete", async () => {
    const onDecisionComplete = vi.fn();
    const onOpenChange = vi.fn();

    // First call: blob fetch. Second call: decision submit.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

    await renderOpenLightbox({
      onOpenChange,
      onDecisionComplete,
    });

    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(screen.getByText("Confirm Approve")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Confirm Approve"));

    await waitFor(() => {
      // Decision endpoint called
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/verification/decide",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"decision":"approved"'),
        })
      );
    });

    await waitFor(() => {
      expect(onDecisionComplete).toHaveBeenCalled();
    });
  });

  it("shows Full Evidence Desk link when evidenceDeskEnabled is true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox({ evidenceDeskEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("Full Evidence Desk")).toBeDefined();
    });
  });

  it("hides Full Evidence Desk link when evidenceDeskEnabled is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox({ evidenceDeskEnabled: false });

    await waitFor(() => {
      expect(screen.queryByText("Full Evidence Desk")).toBeNull();
    });
  });

  it("shows error state when blob fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Decrypt failed" }),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByText("Decrypt failed")).toBeDefined();
    });
  });

  it("shows purge warning when purge_after is set", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    const artifactWithPurge = {
      ...MOCK_ARTIFACT,
      purge_after: "2026-04-01T00:00:00Z",
    };

    await renderOpenLightbox({ artifact: artifactWithPurge });

    await waitFor(() => {
      expect(screen.getByText(/scheduled for purge/i)).toBeDefined();
    });
  });

  it("includes security notice text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    expect(screen.getByText(/decrypted server-side/i)).toBeDefined();
  });
});
