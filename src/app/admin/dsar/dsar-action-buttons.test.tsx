import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DsarActionButtons } from "./dsar-action-buttons";
import { adminDsarCompleteSchema, adminDsarDecideSchema } from "@/lib/validations/admin";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

describe("DsarActionButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "completed" }),
      })
    );
  });

  it("opens a completion dialog for in-progress requests and submits notes", async () => {
    render(
      <DsarActionButtons
        requestId="req-123"
        status="in_progress"
        requestType="access"
        identityVerified
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /complete request/i }));

    expect(screen.getByText("Complete Data Request")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/summarize what was delivered/i), {
      target: { value: "Export delivered securely to the requester" },
    });

    fireEvent.click(screen.getByRole("button", { name: /confirm completion/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/dsar/complete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            requestId: "req-123",
            notes: "Export delivered securely to the requester",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it("keeps approve/reject actions for submitted requests", () => {
    render(
      <DsarActionButtons
        requestId="req-456"
        status="submitted"
        requestType="access"
        identityVerified={false}
      />
    );

    expect(screen.getByRole("button", { name: /approve request/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject request/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete request/i })).not.toBeInTheDocument();
  });

  it("requires an explicit identity confirmation before enabling completion after refresh", async () => {
    const { rerender } = render(
      <DsarActionButtons
        requestId={requestId}
        status="in_progress"
        requestType="access"
        identityVerified={false}
      />
    );
    expect(screen.getByRole("button", { name: /complete request/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^verify identity$/i }));
    expect(screen.getByText("Verify Requester Identity")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /i have verified/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());

    const [url, options] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/admin/dsar/decide");
    expect(adminDsarDecideSchema.parse(JSON.parse(options!.body as string))).toEqual({
      requestId,
      decision: "verify_identity",
    });
    // A successful request still requires the authoritative refreshed case state.
    expect(screen.getByRole("button", { name: /complete request/i })).toBeDisabled();
    rerender(
      <DsarActionButtons
        requestId={requestId}
        status="in_progress"
        requestType="access"
        identityVerified
      />
    );
    expect(screen.getByRole("button", { name: /complete request/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^verify identity$/i })).not.toBeInTheDocument();
  });

  it("keeps failed identity verification retryable without unlocking completion", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "Request not found or already processed" }),
    } as Response);
    render(
      <DsarActionButtons
        requestId={requestId}
        status="in_progress"
        requestType="access"
        identityVerified={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^verify identity$/i }));
    fireEvent.click(screen.getByRole("button", { name: /i have verified/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request not found or already processed"
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /i have verified/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /complete request/i })).toBeDisabled();
  });

  it("requires deletion attestation and submits it separately from completion notes", async () => {
    render(
      <DsarActionButtons
        requestId={requestId}
        status="in_progress"
        requestType="deletion"
        identityVerified
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /complete request/i }));
    const confirm = screen.getByRole("button", { name: /confirm completion/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Completion Summary"), {
      target: { value: "Request fulfilled" },
    });
    expect(confirm).toBeDisabled();
    const attestation = screen.getByLabelText(/deletion attestation/i);
    fireEvent.change(attestation, { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.change(attestation, {
      target: { value: "  Removed the requested account records manually.  " },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());

    const [url, options] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/admin/dsar/complete");
    expect(adminDsarCompleteSchema.parse(JSON.parse(options!.body as string))).toEqual({
      requestId,
      notes: "Request fulfilled",
      deletionAttestation: "Removed the requested account records manually.",
    });
  });

  it("retains attestation and displays server failure for a completion retry", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "Identity must be verified before completing this request" }),
    } as Response);
    render(
      <DsarActionButtons
        requestId={requestId}
        status="in_progress"
        requestType="deletion"
        identityVerified
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /complete request/i }));
    fireEvent.change(screen.getByLabelText(/deletion attestation/i), {
      target: { value: "Requested records removed." },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm completion/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Identity must be verified");
    expect(screen.getByLabelText(/deletion attestation/i)).toHaveValue(
      "Requested records removed."
    );
    expect(screen.getByRole("button", { name: /confirm completion/i })).toBeEnabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
