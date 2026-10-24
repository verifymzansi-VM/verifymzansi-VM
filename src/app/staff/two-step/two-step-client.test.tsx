import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StaffTwoStepClient } from "./two-step-client";
const { listFactors, unenroll, enroll, challengeAndVerify, replace, refresh } = vi.hoisted(() => ({
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa: { listFactors, unenroll, enroll, challengeAndVerify } } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "source" }));
const empty = { data: { totp: [], all: [] }, error: null };
const verified = { id: "synthetic-factor", status: "verified", factor_type: "totp" };
beforeEach(() => {
  vi.clearAllMocks();
  listFactors.mockResolvedValue(empty);
  unenroll.mockResolvedValue({ error: null });
  enroll.mockResolvedValue({
    data: {
      id: "synthetic-factor",
      totp: { qr_code: "not-a-data-uri", secret: "synthetic-authenticator-key" },
    },
    error: null,
  });
  challengeAndVerify.mockResolvedValue({ error: null });
});
it("supports ordinary-account enrolment with its explicit account label", async () => {
  render(<StaffTwoStepClient next="/dashboard" friendlyName="VerifyMzansi account" />);
  fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator app" }));
  await screen.findByLabelText("6-digit code");
  expect(enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "VerifyMzansi account" });
  expect(unenroll).not.toHaveBeenCalled();
});
it("does not enrol or remove factors when factor discovery fails", async () => {
  listFactors.mockRejectedValue(new Error("transport unavailable"));
  render(<StaffTwoStepClient next="/admin" />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Set up authenticator app" }));
  await waitFor(() => expect(listFactors).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Set up authenticator app" })).not.toBeDisabled()
  );
  expect(enroll).not.toHaveBeenCalled();
  expect(unenroll).not.toHaveBeenCalled();
});
it("does not create another factor if unverified-factor cleanup fails", async () => {
  listFactors.mockResolvedValueOnce(empty).mockResolvedValue({
    data: { totp: [], all: [{ id: "pending", status: "unverified", factor_type: "totp" }] },
    error: null,
  });
  unenroll.mockResolvedValue({ error: new Error("cleanup denied") });
  render(<StaffTwoStepClient next="/admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator app" }));
  await screen.findByRole("alert");
  expect(unenroll).toHaveBeenCalledWith({ factorId: "pending" });
  expect(enroll).not.toHaveBeenCalled();
});
it("reuses a verified factor that appeared since the first read", async () => {
  listFactors
    .mockResolvedValueOnce(empty)
    .mockResolvedValue({ data: { totp: [verified], all: [verified] }, error: null });
  render(<StaffTwoStepClient next="/admin" />);
  fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator app" }));
  await screen.findByLabelText("6-digit code");
  expect(enroll).not.toHaveBeenCalled();
  expect(unenroll).not.toHaveBeenCalled();
});
it("clears an unsuccessful code and does not navigate after a transport failure", async () => {
  listFactors.mockResolvedValue({ data: { totp: [verified], all: [verified] }, error: null });
  challengeAndVerify.mockRejectedValue(new Error("transport unavailable"));
  render(<StaffTwoStepClient next="/admin" />);
  const input = await screen.findByLabelText("6-digit code");
  fireEvent.change(input, { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await screen.findByRole("alert");
  expect(input).toHaveValue("");
  expect(replace).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("preserves successful navigation for the existing fixture lane", async () => {
  listFactors.mockResolvedValue({ data: { totp: [verified], all: [verified] }, error: null });
  render(<StaffTwoStepClient next="/admin" />);
  fireEvent.change(await screen.findByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  expect(refresh).toHaveBeenCalledTimes(1);
});
