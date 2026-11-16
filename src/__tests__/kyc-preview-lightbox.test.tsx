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
// The staff-account check on evidence responses has its own tests.
vi.mock("@/lib/auth/staff-evidence-fetch", () => ({
  fetchStaffEvidence: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  handleStaffEvidenceResponse: async (response: Response) => response,
}));

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

const { KycPreviewLightbox, EVIDENCE_FETCH_TIMEOUT_MS } =
  await import("@/components/admin/kyc-preview-lightbox");

// ── Test data ────────────────────────────────────────────────

// Evidence loads only for a claimed identity submission.
const SCOPE = {
  caseId: "11111111-1111-4111-8111-000000000001",
  caseVersion: 7,
  submissionId: "11111111-1111-4111-8111-000000000002",
  claimGeneration: "4",
  claimNonce: "11111111-1111-4111-8111-000000000003",
};

const MOCK_STEP = {
  id: "step-1",
  user_id: "user-1",
  step_type: "id_doc",
  status: "pending",
  created_at: "2025-01-01T00:00:00Z",
  account_display_name: "Test Account",
  account_verification_status: "pending_review",
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
  foundation: SCOPE,
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
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/verification/evidence",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ artifactId: "art-1", foundation: SCOPE }),
        })
      );
    });

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });
  });

  it("shows the account name and step type in header", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    expect(screen.getByText("Test Account")).toBeDefined();
    expect(screen.getByText("ID Document")).toBeDefined();
  });

  it.each(["high", "critical"])(
    "requires and submits an override for a %s risk selfie",
    async (riskLevel) => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
        })
        .mockResolvedValueOnce({ ok: true });
      const onDecisionComplete = vi.fn();
      await renderOpenLightbox({
        step: { ...MOCK_STEP, step_type: "selfie", risk_level: riskLevel },
        onDecisionComplete,
      });

      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm Approve" }));
      expect(screen.getByText(/override reason code is required/i)).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      fireEvent.change(screen.getByLabelText(/override reason/i), {
        target: { value: "supporting_evidence" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm Approve" }));
      await waitFor(() => expect(onDecisionComplete).toHaveBeenCalledOnce());
      expect(mockFetch).toHaveBeenLastCalledWith(
        "/api/admin/verification/decide",
        expect.objectContaining({
          body: JSON.stringify({
            stepId: "step-1",
            decision: "approved",
            overrideReasonCode: "supporting_evidence",
            foundation: SCOPE,
            stepMatches: true,
          }),
        })
      );
    }
  );

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
      expect(
        screen.getByText(/confirm that the id number and legal name match the submitted details/i)
      ).toBeDefined();
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

  it("asks for a note to the member before sending a rejection", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });

    await renderOpenLightbox();
    await waitFor(() => expect(screen.getByText("Reject")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Reject"));
    fireEvent.change(await screen.findByTitle("Reason code"), {
      target: { value: "blurry_image" },
    });
    fireEvent.click(screen.getByText("Confirm Reject"));

    expect(
      await screen.findByText("Please write a note telling the member what to fix.")
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalledWith("/api/admin/verification/decide", expect.anything());

    fireEvent.change(screen.getByLabelText(/Note to the member/), {
      target: { value: "Please retake the photo without glare." },
    });
    fireEvent.click(screen.getByText("Confirm Reject"));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/verification/decide",
        expect.objectContaining({
          body: expect.stringContaining('"reasonNote":"Please retake the photo without glare."'),
        })
      )
    );
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
      expect(screen.getByText("Open in evidence desk")).toBeDefined();
    });
  });

  it("hides Full Evidence Desk link when evidenceDeskEnabled is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox({ evidenceDeskEnabled: false });

    await waitFor(() => {
      expect(screen.queryByText("Open in evidence desk")).toBeNull();
    });
  });

  it("shows error state when blob fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: "server_error", error: "Decrypt failed" }),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByText(/server error retrieving evidence/i)).toBeDefined();
    });
  });

  it("stops an indefinitely pending evidence request and lets the reviewer retry", async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true }
          );
        })
    );

    try {
      await renderOpenLightbox();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(EVIDENCE_FETCH_TIMEOUT_MS * 2 + 601);
      });

      expect(screen.getByText(/document took too long to load/i)).toBeDefined();
      const retryButton = screen.getByRole("button", { name: /try again/i });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await act(async () => {
        fireEvent.click(retryButton);
        await Promise.resolve();
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reloads the document automatically after the tab becomes visible", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.queryByText(/cleared for security/i)).toBeNull();

    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/decrypting and loading/i)).toBeNull();
    expect(screen.getByAltText("Evidence: id_doc")).toBeDefined();
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

  it("updates image wrapper zoom class and resets to default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })),
    });

    await renderOpenLightbox();

    await waitFor(() => {
      expect(screen.getByLabelText("Zoom in")).toBeDefined();
    });

    const image = screen.getByAltText("Evidence: id_doc");
    const wrapper = image.parentElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toContain("w-full");

    fireEvent.click(screen.getByLabelText("Zoom in"));

    await waitFor(() => {
      expect(screen.getByAltText("Evidence: id_doc").parentElement?.className).toContain(
        "w-[125%]"
      );
    });

    fireEvent.click(screen.getByLabelText("Reset zoom"));

    await waitFor(() => {
      expect(screen.getByAltText("Evidence: id_doc").parentElement?.className).toContain("w-full");
    });
  });
});
