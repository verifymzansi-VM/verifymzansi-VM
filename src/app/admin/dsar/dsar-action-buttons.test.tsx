import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DsarActionButtons } from "./dsar-action-buttons";

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
    render(<DsarActionButtons requestId="req-123" status="in_progress" />);

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
    render(<DsarActionButtons requestId="req-456" status="submitted" />);

    expect(screen.getByRole("button", { name: /approve request/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject request/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete request/i })).not.toBeInTheDocument();
  });
});
