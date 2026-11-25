import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityCheckSettings } from "@/lib/admin/identity-check-settings";
import { IdentityCheckSettingsCard } from "./identity-check-settings-card";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const postStaffCommand = vi.fn();
vi.mock("@/lib/admin/post-staff-command", () => ({
  postStaffCommand: (...args: unknown[]) => postStaffCommand(...args),
}));

const settings = (over: Partial<IdentityCheckSettings> = {}): IdentityCheckSettings => ({
  mode: "manual",
  pausedUntil: null,
  pauseReason: null,
  last7Days: { checks: 0, approved: 0, withStaff: 0, declined: 0, askedPerson: 0 },
  recentChanges: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  postStaffCommand.mockResolvedValue({ ok: true, data: { changed: true, resumed: false } });
});

describe("the ID checks card", () => {
  it("shows the three settings to every staff member, read-only unless they may change it", () => {
    render(<IdentityCheckSettingsCard settings={settings()} canChange={false} />);
    for (const name of [/^Manual/, /Didit, staff have the final say/, /Didit fully automatic/])
      expect(screen.getByRole("radio", { name })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /^Manual/ })).toBeChecked();
    expect(screen.queryByRole("button", { name: /Save setting/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Reason for the change/i)).not.toBeInTheDocument();
  });

  it("shows the Didit settings disabled until consent recording is live", () => {
    render(<IdentityCheckSettingsCard settings={settings()} canChange />);
    expect(screen.getByRole("radio", { name: /^Manual/ })).toBeEnabled();
    for (const name of [/Didit, staff have the final say/, /Didit fully automatic/]) {
      const radio = screen.getByRole("radio", { name });
      expect(radio).toBeDisabled();
      expect(radio).not.toBeChecked();
    }
    expect(
      screen.getByText("The two Didit settings switch on once consent recording is live.")
    ).toBeTruthy();
  });

  it("saves a new setting with its reason", async () => {
    render(<IdentityCheckSettingsCard settings={settings({ mode: "staff_final" })} canChange />);
    fireEvent.click(screen.getByRole("radio", { name: /^Manual/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save setting/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason of 5 to 500/);
    expect(postStaffCommand).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason for the change/i), {
      target: { value: "Back to staff review for now" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save setting/i }));
    await waitFor(() =>
      expect(postStaffCommand).toHaveBeenCalledWith(
        "/api/admin/identity-check-settings",
        { mode: "manual", reason: "Back to staff review for now" },
        expect.any(String)
      )
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Setting saved.");
    expect(refresh).toHaveBeenCalled();
  });

  it("sends staff to verify their authenticator again when the 2-step check is too old", async () => {
    postStaffCommand.mockResolvedValue({
      ok: false,
      reason: "staff_mfa_required",
      message: "Verify your authenticator again, then try again.",
      verifyUrl: "/staff/two-step",
    });
    render(<IdentityCheckSettingsCard settings={settings({ mode: "automatic" })} canChange />);
    fireEvent.click(screen.getByRole("radio", { name: /^Manual/ }));
    fireEvent.change(screen.getByLabelText(/Reason for the change/i), {
      target: { value: "Back to staff review" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save setting/i }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/staff/two-step?next=%2Fadmin%2Fverification")
    );
  });

  it("shows a pause and resumes it by setting the same mode again", async () => {
    postStaffCommand.mockResolvedValue({ ok: true, data: { changed: false, resumed: true } });
    render(
      <IdentityCheckSettingsCard
        settings={settings({
          mode: "staff_final",
          pausedUntil: "2026-11-20T12:15:00Z",
          pauseReason: "no_credit",
        })}
        canChange
      />
    );
    expect(screen.getByText(/Paused: the Didit balance has run out/)).toBeTruthy();
    expect(screen.getByText(/in-page camera and staff check them/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume Didit checks/i }));
    await waitFor(() =>
      expect(postStaffCommand).toHaveBeenCalledWith(
        "/api/admin/identity-check-settings",
        { mode: "staff_final", reason: "Resume after a pause" },
        expect.any(String)
      )
    );
    expect(await screen.findByText("Didit checks resumed.")).toBeTruthy();
  });

  it("shows the last 7 days and the latest changes while Didit works", () => {
    render(
      <IdentityCheckSettingsCard
        settings={settings({
          mode: "staff_final",
          last7Days: { checks: 42, approved: 36, withStaff: 6, declined: 0, askedPerson: 0 },
          recentChanges: [
            {
              fromMode: "manual",
              toMode: "staff_final",
              reason: "Launch: Didit on",
              changedAt: "2026-11-20T10:00:00Z",
            },
          ],
        })}
        canChange={false}
      />
    );
    expect(screen.getByText("Didit working")).toBeTruthy();
    expect(
      screen.getByText("Last 7 days: 42 Didit checks · 36 approved · 6 sent to staff")
    ).toBeTruthy();
    expect(screen.getByText(/20 Nov 2026, 12:00: Manual → Didit, staff final say/)).toBeTruthy();
  });
});
