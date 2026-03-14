import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./header";

const setTheme = vi.fn();
const signOut = vi.fn();
const useAuthMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../shared/brand-logo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: () => <div data-testid="trust-badge" />,
}));

vi.mock("@/components/notification-bell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock("./marketplace-switcher", () => ({
  MarketplaceSwitcher: () => <div data-testid="marketplace-switcher" />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <div />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows advertiser entry points for authenticated users", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      user: { id: "user-1", email: "hello@example.com", displayName: "Test User" },
      trustLevel: 3,
      isModerator: false,
      signOut,
    });

    render(<Header />);

    expect(screen.getByRole("link", { name: /^Promotions & Events$/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    expect(screen.getByRole("link", { name: /Advertise in Promotions & Events/i })).toHaveAttribute(
      "href",
      "/post/create-promotion"
    );
  });

  it("shows promotions browsing for signed-out users in the mobile menu", () => {
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      user: null,
      trustLevel: 0,
      isModerator: false,
      signOut,
    });

    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: /Open menu/i }));

    expect(screen.getByRole("link", { name: /Browse Promotions & Events/i })).toHaveAttribute(
      "href",
      "/promotions"
    );
  });
});
