import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
