import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FoundationAccountContext } from "@/lib/foundation/account-context";
import {
  foundationShowsAdminLink,
  foundationSessionRole,
  isStaffRole,
} from "@/lib/auth/session-display";
import { Header } from "./header";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("./marketplace-switcher", () => ({ MarketplaceSwitcher: () => null }));
vi.mock("@/components/video-mode/video-mode-entry", () => ({ VideoModeEntry: () => null }));

type Staff = FoundationAccountContext["staff"];

/** The useAuth view for an account context, built with the same helpers the hook uses. */
function signedIn(staff: Staff, totpEnrolled: boolean) {
  const role = foundationSessionRole(staff);
  auth.current = {
    user: { id: "acct-1", email: "person@example.test", displayName: "Thando Dube", role },
    profile: null,
    trustLevel: 0,
    isLoading: false,
    isAuthenticated: true,
    isStaff: isStaffRole(role),
    showAdminLink: foundationShowsAdminLink({ staff, totp_enrolled: totpEnrolled }),
    signOut: vi.fn(),
  };
}

const invitedHint: Staff = { role: "admin", can_access: false, assigned_capabilities: [] };
const lapsedAdmin: Staff = { role: "admin", can_access: false, assigned_capabilities: ["x"] };

async function openMobileMenu() {
  await userEvent.click(screen.getByTestId("mobile-menu-toggle"));
  return screen.getByRole("navigation", { name: "Mobile navigation" });
}

async function openAccountMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
  return screen.findByRole("menu");
}

describe("Header Admin link", () => {
  beforeEach(() => {
    auth.current = {};
  });

  it("hides Admin from an invited administrator without an authenticator app", async () => {
    signedIn(invitedHint, false);
    render(<Header />);
    const mobile = await openMobileMenu();
    expect(within(mobile).getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(within(mobile).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    const menu = await openAccountMenu();
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("shows Admin to enrolled staff whose two-step check has lapsed", async () => {
    signedIn(lapsedAdmin, true);
    render(<Header />);
    const mobile = await openMobileMenu();
    expect(within(mobile).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    const menu = await openAccountMenu();
    expect(within(menu).getByRole("menuitem", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("shows Admin to staff with a current two-step check", async () => {
    signedIn({ role: "moderator", can_access: true, assigned_capabilities: [] }, true);
    render(<Header />);
    const mobile = await openMobileMenu();
    expect(within(mobile).getByRole("link", { name: "Admin" })).toBeInTheDocument();
  });

  it("hides Admin from members, even with an authenticator app", async () => {
    signedIn(null, true);
    render(<Header />);
    const mobile = await openMobileMenu();
    expect(within(mobile).queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    const menu = await openAccountMenu();
    expect(within(menu).queryByRole("menuitem", { name: "Admin" })).not.toBeInTheDocument();
  });
});
