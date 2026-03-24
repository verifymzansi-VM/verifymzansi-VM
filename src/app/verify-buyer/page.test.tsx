import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VerifyBuyerPage from "./page";
import { useToast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("@/components/layout/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/layout/footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => (
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
  ),
}));

describe("VerifyBuyerPage", () => {
  const mockToast = vi.fn();
  const validToken = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      toast: mockToast,
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: "valid",
        buyerInfo: {
          displayName: "S",
          verifiedAt: "2026-02-20T10:00:00.000Z",
        },
      }),
    }) as unknown as typeof fetch;
  });

  it("renders the page title", () => {
    render(<VerifyBuyerPage />);
    expect(screen.getByRole("heading", { name: "Verify a Buyer" })).toBeInTheDocument();
  });

  it("shows valid result state", async () => {
    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: validToken },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/verify-buyer",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    expect(await screen.findByText("Verified Buyer")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("shows expired state", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: "expired" }),
    });

    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: validToken },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    expect(await screen.findByText("Token expired")).toBeInTheDocument();
  });

  it("shows validation toast and skips fetch for invalid UUID", () => {
    render(<VerifyBuyerPage />);

    fireEvent.change(screen.getByLabelText("Buyer Token"), {
      target: { value: "invalid-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify buyer token/i }));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Enter a valid token",
        variant: "destructive",
      })
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
