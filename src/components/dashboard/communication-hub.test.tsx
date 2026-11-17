import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationHub } from "./communication-hub";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const ALL_OFF = {
  marketing_email: false,
  marketing_sms: false,
  analytics: false,
  third_party_sharing: false,
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = url.startsWith("/api/communications/preferences")
        ? { preferences: ALL_OFF }
        : url.startsWith("/api/communications/email-activity")
          ? { items: [] }
          : { notifications: [], unreadCount: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("CommunicationHub preferences", () => {
  it("shows the two marketing switches and hides Analytics and Third-party sharing until they work", async () => {
    render(<CommunicationHub />);
    await userEvent.click(screen.getByRole("tab", { name: /Preferences/i }));

    expect(await screen.findByRole("switch", { name: "Marketing email" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Marketing SMS" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Third-party sharing" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });
});
