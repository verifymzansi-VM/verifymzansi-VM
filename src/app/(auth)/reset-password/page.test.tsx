import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResetPasswordPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("ResetPasswordPage keyboard access", () => {
  it("lets keyboard users reveal both password fields", async () => {
    document.cookie = `vm_csrf=${"d".repeat(64)}; path=/`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ valid: true }),
      })
    );
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    const password = await screen.findByLabelText("New password");
    password.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Show password" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(password).toHaveAttribute("type", "text");
    const confirmation = screen.getByLabelText("Confirm password");
    confirmation.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Show confirm password" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(confirmation).toHaveAttribute("type", "text");
  });
});

describe("ResetPasswordPage recovery session check", () => {
  beforeEach(() => {
    document.cookie = `vm_csrf=${"d".repeat(64)}; path=/`;
  });

  function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }

  it("shows a retryable error (not 'expired') when the check fails on the network", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(jsonResponse(200, { valid: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ResetPasswordPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't check your reset link. Check your connection and try again."
    );
    expect(screen.queryByText("Reset link expired")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/auth/reset-password")).toHaveLength(
      2
    );
  });

  it("shows a retryable error when the check returns a 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(503, { error: "Internal server error" }))
    );

    render(<ResetPasswordPage />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Reset link expired")).not.toBeInTheDocument();
  });

  it("still reports an expired link when the server says the session is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { valid: false })));

    render(<ResetPasswordPage />);

    expect(await screen.findByText("Reset link expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("keeps typed passwords and shows a recoverable error when saving fails on the network", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/reset-password" && init?.method === "POST") {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(200, { valid: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ResetPasswordPage />);

    const password = await screen.findByLabelText("New password");
    const confirmation = screen.getByLabelText("Confirm password");
    await user.type(password, "Str0ng!Passw0rd#2026");
    await user.type(confirmation, "Str0ng!Passw0rd#2026");
    await user.click(screen.getByRole("button", { name: "Save password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't save your new password. Check your connection and try again."
    );
    expect(password).toHaveValue("Str0ng!Passw0rd#2026");
    expect(confirmation).toHaveValue("Str0ng!Passw0rd#2026");
    expect(screen.getByRole("button", { name: "Save password" })).toBeEnabled();
    expect(screen.queryByText("Reset link expired")).not.toBeInTheDocument();
  });
});
