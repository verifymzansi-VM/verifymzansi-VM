"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Menu,
  X,
  ShieldAlert,
  LayoutDashboard,
  Settings,
  LogOut,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BrandLogo } from "../shared/brand-logo";
import { TrustBadge } from "@/components/trust/trust-badge";
import { NotificationBell } from "@/components/notification-bell";
import { MarketplaceSwitcher } from "./marketplace-switcher";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import type { TrustLevel } from "@/types/enums";

interface HeaderProps {
  /** Pass `true` to skip the session check (e.g. dashboard layout already knows). */
  isAuthenticated?: boolean;
  displayName?: string;
  trustLevel?: TrustLevel;
}

export function Header(props: HeaderProps) {
  return (
    <ErrorBoundary
      label="Header"
      fallback={
        <header className="sticky top-0 z-50 w-full border-b bg-background">
          <div className="container-page flex h-16 items-center">
            <Link href="/" className="text-lg font-bold">
              VerifyMzansi
            </Link>
          </div>
        </header>
      }
    >
      <HeaderInner {...props} />
    </ErrorBoundary>
  );
}

function HeaderInner({
  isAuthenticated: isAuthProp,
  displayName: displayNameProp,
  trustLevel: trustLevelProp = 0,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { theme, setTheme } = useTheme();

  // Use the shared auth store via useAuth() instead of a duplicate Supabase subscription
  const auth = useAuth();

  const isAuthenticated = isAuthProp ?? auth.isAuthenticated;
  const finalDisplayName = displayNameProp || auth.user?.displayName || "";
  const email = auth.user?.email || "";
  const initials = finalDisplayName
    ? finalDisplayName
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";
  const hasAdminAccess = auth.isModerator; // isModerator already includes admin role

  // Sheet component automatically handles Escape key and body scroll locking!

  async function handleSignOut() {
    setSigningOut(true);
    await auth.signOut();
  }

  return (
    <header className="sticky top-0 z-[110] isolate w-full border-b bg-background lg:bg-background/95 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-background/60">
      <div className="container-page grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Link
          href="/"
          aria-label="VerifyMzansi — Home"
          className="group flex items-center gap-2 sm:gap-3 lg:justify-self-start"
        >
          <BrandLogo
            size="md"
            variant="transparent"
            priority
            imageClassName="drop-shadow-[0_10px_20px_rgba(15,23,42,0.08)] transition-transform duration-200 group-hover:scale-105"
          />
        </Link>

        {/* Marketplace Switcher — hidden on mobile, shown lg+ */}
        <div className="hidden lg:flex lg:justify-self-center">
          <MarketplaceSwitcher />
        </div>

        {/* Desktop Right — Auth */}
        <div className="hidden items-center gap-2 lg:flex lg:justify-self-end">
          {/* Theme toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          {isAuthenticated ? (
            <>
              <NotificationBell userId={auth.user?.id} />
              {(trustLevelProp || auth.trustLevel) > 0 && (
                <TrustBadge level={trustLevelProp || auth.trustLevel} size="sm" />
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/advertise">Advertise</Link>
              </Button>
              <Button asChild variant="trust-verified" size="sm">
                <Link href="/post/create">+ Post</Link>
              </Button>

              {/* User avatar dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="focus:outline-none rounded-full ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Account menu"
                  >
                    <Avatar className="h-9 w-9 cursor-pointer border-2 border-brand-gold">
                      <AvatarFallback className="bg-brand-gold text-amber-950 text-xs font-bold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-semibold leading-none">
                        {finalDisplayName || "My Account"}
                      </p>
                      {email && (
                        <p className="text-xs leading-none text-muted-foreground">{email}</p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="cursor-pointer">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/settings" className="cursor-pointer">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    {hasAdminAccess && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin" className="cursor-pointer">
                          <ShieldAlert className="mr-2 h-4 w-4" />
                          Admin
                        </Link>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:text-destructive"
                    disabled={signingOut}
                    onSelect={(e) => {
                      e.preventDefault();
                      handleSignOut();
                    }}
                  >
                    {signingOut ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="mr-2 h-4 w-4" />
                    )}
                    {signingOut ? "Signing out…" : "Sign Out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/advertise">Advertise</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-brand-green border-2 hover:bg-brand-green/10"
                size="sm"
              >
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild variant="trust-verified" size="sm">
                <Link href="/register">Register</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Hamburger */}
        <button
          type="button"
          className="relative z-[120] justify-self-end rounded-md p-2 lg:hidden touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen ? "true" : "false"}
          data-testid="mobile-menu-toggle"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Marketplace Tabs — always visible on mobile */}
      <div className="lg:hidden w-full border-t bg-background/95">
        <div className="px-3 py-1.5">
          <MarketplaceSwitcher />
        </div>
      </div>

      {/* Mobile Menu (Bottom Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-xl px-4 pt-6 pb-safe h-[85vh] overflow-hidden flex flex-col"
        >
          <SheetHeader className="mb-4 text-left Shrink-0">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto pr-2 pb-6 flex flex-col gap-2">
            {isAuthenticated ? (
              <>
                {/* Mobile user info */}
                <div className="flex items-center gap-3 px-1 py-2 mb-2">
                  <Avatar className="h-10 w-10 border-2 border-brand-gold">
                    <AvatarFallback className="bg-brand-gold text-amber-950 text-xs font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col flex-1">
                    <span className="text-sm font-semibold">
                      {finalDisplayName || "My Account"}
                    </span>
                    {email && <span className="text-xs text-muted-foreground">{email}</span>}
                  </div>
                  <NotificationBell userId={auth.user?.id} />
                </div>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 py-3 text-base font-medium"
                  onClick={() => setMobileOpen(false)}
                >
                  <LayoutDashboard className="h-5 w-5" />
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/settings"
                  className="flex items-center gap-2 py-3 text-base font-medium"
                  onClick={() => setMobileOpen(false)}
                >
                  <Settings className="h-5 w-5" />
                  Settings
                </Link>
                {hasAdminAccess && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 py-3 text-base font-medium"
                    onClick={() => setMobileOpen(false)}
                  >
                    <ShieldAlert className="h-5 w-5" />
                    Admin
                  </Link>
                )}
                <div className="mt-4 flex flex-col gap-3">
                  <Button asChild variant="trust-verified" size="lg" className="w-full">
                    <Link href="/post/create" onClick={() => setMobileOpen(false)}>
                      + Post
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="w-full">
                    <Link href="/advertise" onClick={() => setMobileOpen(false)}>
                      Advertise
                    </Link>
                  </Button>
                </div>
                <button
                  className="flex items-center gap-2 py-3 mt-4 text-base font-medium text-destructive disabled:opacity-50"
                  disabled={signingOut}
                  onClick={() => {
                    handleSignOut();
                  }}
                >
                  {signingOut ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <LogOut className="h-5 w-5" />
                  )}
                  {signingOut ? "Signing out…" : "Sign Out"}
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3 pt-2">
                <Button asChild variant="trust-verified" size="lg" className="w-full">
                  <Link href="/register" onClick={() => setMobileOpen(false)}>
                    Register
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full">
                  <Link href="/login" onClick={() => setMobileOpen(false)}>
                    Sign In
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="w-full mt-2">
                  <Link href="/advertise" onClick={() => setMobileOpen(false)}>
                    Advertise with us
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
