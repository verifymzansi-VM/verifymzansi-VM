import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinueOnPhonePanel, type HandoffCodeCache } from "./continue-on-phone";

const details = { idNumber: "8001015009087", firstName: "Thando", lastName: "Dlamini" };
const code = () => ({
  qr: { size: 21, path: "M0 0h1v1H0z" },
  expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
});
const fetchMock = vi.fn();

function panel(cache: HandoffCodeCache, typed = details) {
  return render(
    <ContinueOnPhonePanel
      details={typed}
      codeCacheRef={cache}
      onBack={() => {}}
      isDone={async () => false}
      onDone={() => {}}
    />
  );
}
const linksMade = () =>
  fetchMock.mock.calls.filter(([url]) => url === "/api/verification/handoff").length;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(code()), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Continue on your phone codes", () => {
  it("shows the page's last code again after Back, keeping only a digest of the details", async () => {
    const cache: HandoffCodeCache = { current: null };
    const first = panel(cache);
    await screen.findByRole("img", { name: /QR code/ });
    first.unmount();
    expect(JSON.stringify(cache.current)).not.toContain(details.idNumber);
    expect(cache.current?.key).toMatch(/^[a-f0-9]{64}$/);

    panel(cache);
    await screen.findByRole("img", { name: /QR code/ });
    expect(linksMade()).toBe(1);
  });

  it("makes a new link for other details or on another page", async () => {
    const cache: HandoffCodeCache = { current: null };
    panel(cache).unmount();
    await waitFor(() => expect(cache.current).not.toBeNull());

    panel(cache, { ...details, firstName: "Sipho" }).unmount();
    await waitFor(() => expect(linksMade()).toBe(2));

    // Another page (for example after signing out and in again) has its own cache.
    panel({ current: null });
    await waitFor(() => expect(linksMade()).toBe(3));
  });
});
