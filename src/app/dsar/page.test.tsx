import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DsarPage from "./page";

const mockToast = vi.fn();

vi.mock("@/components/layout/header", () => ({ Header: () => <div>Header</div> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <div>Footer</div> }));
vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));
vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" onClick={() => onSuccess("turnstile-token")}>
      Complete captcha
    </button>
  ),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("DSAR page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          requestId: "case-123",
          reference: "DSAR-ABCD1234",
        }),
      })
    );
  });

  it("renders the server-issued reference after a successful submission", async () => {
    render(<DsarPage />);

    fireEvent.change(screen.getByLabelText("Full Name *"), {
      target: { value: "Nomsa Dlamini" },
    });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });
    fireEvent.change(screen.getByLabelText("Additional Details"), {
      target: { value: "Please send me a copy of my stored data." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(screen.getByText("Request Submitted")).toBeInTheDocument();
    });

    expect(screen.getByText(/Reference: DSAR-ABCD1234/)).toBeInTheDocument();
    expect(screen.getByText(/Case ID: case-123/)).toBeInTheDocument();
  });

  it("shows a safe error message when submission fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "database exploded",
          requestId: "case-500",
          reference: "DSAR-FAIL500",
        }),
      })
    );

    render(<DsarPage />);

    fireEvent.change(screen.getByLabelText("Full Name *"), {
      target: { value: "Nomsa Dlamini" },
    });
    fireEvent.change(screen.getByLabelText("Email Address *"), {
      target: { value: "nomsa@example.com" },
    });
    fireEvent.change(screen.getByLabelText("SA ID Number *"), {
      target: { value: "8001015009087" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Complete captcha" }));
    fireEvent.click(screen.getByRole("button", { name: /submit request/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Failed to submit request",
        description: expect.stringContaining("privacy@verifymzansi.com"),
      })
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("Reference: DSAR-FAIL500"),
      })
    );
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.not.stringContaining("database exploded"),
      })
    );
  });
});
