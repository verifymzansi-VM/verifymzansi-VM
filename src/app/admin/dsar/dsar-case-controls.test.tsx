import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DsarCaseControls } from "./dsar-case-controls";

const { refreshMock, pushMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
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

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const props = {
  requestId: REQUEST_ID,
  viewerId: "staff-1",
  assignedTo: null,
  identityVerified: true,
  canExtend: true,
  extensionDays: 30,
  isOpen: true,
};

const fetchMock = vi.fn();
const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe("DsarCaseControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("exports with a POST and hands the file to the browser", async () => {
    const createUrl = vi.fn(() => "blob:export");
    const revokeUrl = vi.fn();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
    );
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["{}"]),
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="dsar-export-123e4567.json"',
      }),
    });

    render(<DsarCaseControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /export json/i }));

    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:export"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/dsar/export",
      expect.objectContaining({ method: "POST" })
    );
    expect(bodyOf(0)).toEqual({ requestId: REQUEST_ID });
  });

  it("sends staff to confirm their second factor when the export needs it", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ code: "step_up_required", verifyUrl: "/staff/two-step?step=recent" }),
    });

    render(<DsarCaseControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /export json/i }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/staff/two-step?step=recent&next=%2Fadmin%2Fdsar")
    );
  });

  it("cannot export before identity is verified", () => {
    render(<DsarCaseControls {...props} identityVerified={false} />);
    expect(screen.getByRole("button", { name: /export json/i })).toBeDisabled();
  });

  it("extends with a reason that the requester will see", async () => {
    render(<DsarCaseControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /extend/i }));

    const confirm = screen.getByRole("button", { name: /extend and notify/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Records are held in two systems" },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(bodyOf(0)).toEqual({
      action: "extend",
      requestId: REQUEST_ID,
      reason: "Records are held in two systems",
    });
  });

  it("hides the extension when the rules do not allow one", () => {
    render(<DsarCaseControls {...props} canExtend={false} />);
    expect(screen.queryByRole("button", { name: /^extend$/i })).not.toBeInTheDocument();
  });

  it("assigns the case to the viewer, and can hand it back", async () => {
    const { rerender } = render(<DsarCaseControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /assign to me/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(bodyOf(0)).toEqual({ action: "assign", requestId: REQUEST_ID, assigneeId: "staff-1" });

    rerender(<DsarCaseControls {...props} assignedTo="staff-1" />);
    fireEvent.click(screen.getByRole("button", { name: /unassign/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(1)).toEqual({ action: "assign", requestId: REQUEST_ID, assigneeId: null });
  });
});
