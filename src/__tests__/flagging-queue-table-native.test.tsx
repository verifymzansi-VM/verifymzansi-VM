import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { FlaggingQueueTable } from "@/components/admin/flagging-queue-table";
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/admin/queue-claims", () => ({
  ClaimBadge: () => null,
  useQueueClaim: () => ({ blocked: false, blockedReason: null }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div>
        <button onClick={() => onOpenChange(false)}>Dismiss dialog</button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("sends the viewed scope once and keeps a newer report selection after a late acknowledgement", async () => {
  const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
  const reports = ids.map((id, n) => ({
    id,
    target_id: id,
    target_type: "listing",
    category: "misleading_info",
    severity: "standard" as const,
    status: "in_progress",
    description: `Fixture report ${n}`,
    created_at: "2026-11-04T22:00:00Z",
    foundation: { expectedRevision: 2, claimGeneration: "3", claimNonce: id },
  }));
  let finish: (value: Response) => void = () => {};
  fetcher.mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      finish = resolve;
    })
  );
  fetcher.mockResolvedValueOnce(
    Response.json({ success: true, status: "dismissed", message: "Report dismissed." })
  );
  const changed = vi.fn();
  render(<FlaggingQueueTable reports={reports} onActionComplete={changed} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Take action" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss report" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "First independent review" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply action" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply action" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    reportId: ids[0],
    foundation: reports[0].foundation,
  });
  fireEvent.click(screen.getByRole("button", { name: "Dismiss dialog" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Take action" })[1]);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss report" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second independent review" } });
  finish(Response.json({ success: true, status: "dismissed", message: "Report dismissed." }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("textbox")).toHaveValue("Second independent review");
  expect(toast).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply action" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    reportId: ids[1],
    foundation: reports[1].foundation,
  });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
