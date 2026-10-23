import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PasswordMfaChallenge } from "./password-mfa-challenge";

const { listFactors, challengeAndVerify } = vi.hoisted(() => ({
  listFactors: vi.fn(),
  challengeAndVerify: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa: { listFactors, challengeAndVerify } } }),
}));

describe("password authenticator challenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFactors.mockResolvedValue({
      data: {
        totp: [
          { id: "unverified", status: "unverified" },
          { id: "verified", status: "verified" },
        ],
      },
      error: null,
    });
    challengeAndVerify.mockResolvedValue({ error: null });
  });
  function enterCode() {
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
  }
  it("uses an existing verified factor and keeps Enter inside the challenge", async () => {
    const onVerified = vi.fn(),
      onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordMfaChallenge onVerified={onVerified} />
      </form>
    );
    enterCode();
    fireEvent.keyDown(screen.getByLabelText("Authenticator code"), { key: "Enter" });
    await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
    expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: "verified", code: "123456" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("clears refused codes and never advances the password flow", async () => {
    challengeAndVerify.mockResolvedValue({ error: { message: "bad code" } });
    const onVerified = vi.fn();
    render(<PasswordMfaChallenge onVerified={onVerified} />);
    enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Verify authenticator" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code did not work");
    expect(screen.getByLabelText("Authenticator code")).toHaveValue("");
    expect(onVerified).not.toHaveBeenCalled();
  });
  it("does not enroll a replacement when no verified factor exists", async () => {
    listFactors.mockResolvedValue({
      data: { totp: [{ id: "pending", status: "unverified" }] },
      error: null,
    });
    render(<PasswordMfaChallenge onVerified={vi.fn()} />);
    enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Verify authenticator" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Contact support");
    expect(challengeAndVerify).not.toHaveBeenCalled();
  });
  it("keeps verification retryable after a provider outage", async () => {
    listFactors.mockRejectedValue(new Error("offline"));
    render(<PasswordMfaChallenge onVerified={vi.fn()} />);
    enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Verify authenticator" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.getByRole("button", { name: "Verify authenticator" })).toBeEnabled();
  });
});
