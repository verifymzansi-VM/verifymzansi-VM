"use client";

import {
  BrandShield as ShieldCheck,
  BrandShieldAlert as ShieldAlert,
} from "@/components/shared/brand-shield";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  BadgeDollarSign,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  X,
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
import { BrandLogo } from "../shared/brand-logo";
import { TrustBadge } from "@/components/trust/trust-badge";
import { MarketplaceSwitcher } from "./marketplace-switcher";
import { HeaderSearch } from "./header-search";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";

const LOGIN_HREF = "/login?authFresh=20260515";
const REGISTER_HREF = "/register?authFresh=20260515";

const SECONDARY_LINKS = [
  { href: "/safety", label: "Safety Centre", icon: LifeBuoy },
  { href: "/pricing", label: "Pricing", icon: BadgeDollarSign },
  { href: "/advertise", label: "Advertise", icon: Megaphone },
] as const;

const NotificationBell = dynamic(
  () => import("@/components/notification-bell").then((mod) => mod.NotificationBell),
  {
    loading: () => <span className="inline-block h-9 w-9" aria-hidden="true" />,
  }
);
const LiveLeadNotifier = dynamic(() =>
  import("@/components/notifications/live-lead-notifier").then((mod) => mod.LiveLeadNotifier)
);
const LeadNotificationPermissionPrompt = dynamic(() =>
  import("@/components/notifications/lead-notification-permission-prompt").then(
    (mod) => mod.LeadNotificationPermissionPrompt
  )
);

interface HeaderProps {
  /** Pass `true` to skip the session check (e.g. dashboard layout already knows). */
  isAuthenticated?: boolean;
  displayName?: string;
  trustLevel?: TrustLevel;
  /** Hide the header search field where the page leads with its own (homepage hero). */
  showSearch?: boolean;
}

export function Header(props: HeaderProps) {
  return (
    <ErrorBoundary
      label="Header"
      fallback={
        <header className="glass-panel sticky top-0 z-50 w-full">
          <div className="container-page flex h-16 items-center">
            <Link href="/" prefetch={false} className="text-lg font-bold">
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
  showSearch = true,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();

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
  const activeTheme = theme === "system" ? resolvedTheme : theme;
  const isDarkMode = activeTheme === "dark";
  const nextTheme = isDarkMode ? "light" : "dark";

  const handleThemeToggle = useCallback(() => {
    setTheme(nextTheme);
  }, [nextTheme, setTheme]);

  const renderThemeToggle = (className?: string) => (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleThemeToggle}
      aria-label="Toggle theme"
      title="Toggle theme"
      className={cn("rounded-full", className)}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );

  // Close mobile menu on Escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
        mobileToggleRef.current?.focus();
      }
    },
    [mobileOpen]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  // This is an inline disclosure, so the page remains scrollable while it is open.
  // Reset it at the desktop breakpoint instead of keeping a hidden menu open.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  // Scroll-aware header treatment: blur + subtle shadow once the page scrolls
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await auth.signOut();
  }

  const closeMobile = () => setMobileOpen(false);
  const mobileLinkClass =
    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-foreground/90 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <header
      className={cn(
        "glass-panel sticky top-0 z-[110] isolate w-full border-x-0 border-t-0 transition-shadow duration-300",
        scrolled ? "elev-sm" : "shadow-none"
      )}
    >
      {isAuthenticated ? (
        <>
          <LiveLeadNotifier userId={auth.user?.id} />
          <LeadNotificationPermissionPrompt enabled={isAuthenticated} />
        </>
      ) : null}

      <div className="container-page flex h-16 items-center gap-3 lg:gap-6">
        <Link
          href="/"
          prefetch={false}
          aria-label="VerifyMzansi — Home"
          className="group flex shrink-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BrandLogo
            size="md"
            priority
            imageClassName="drop-shadow-[0_10px_20px_rgba(15,23,42,0.08)] transition-transform duration-200 group-hover:scale-[1.03]"
          />
        </Link>

        {/* Global search — the primary way into the platform on larger screens */}
        {showSearch ? (
          <div className="hidden min-w-0 flex-1 md:block md:max-w-md lg:max-w-xl">
            <HeaderSearch />
          </div>
        ) : null}

        {/* Desktop Right — Auth */}
        <div className="ml-auto hidden items-center gap-1.5 lg:flex">
          {renderThemeToggle("relative")}

          {isAuthenticated ? (
            <>
              <NotificationBell userId={auth.user?.id} />
              {(trustLevelProp || auth.trustLevel) > 0 && (
                <TrustBadge level={trustLevelProp || auth.trustLevel} size="sm" />
              )}
              <Button
                asChild
                variant="trust-verified"
                size="sm"
                className="ml-1 h-10 rounded-full px-4"
              >
                <Link href="/post/create" prefetch={false}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Post
                </Link>
              </Button>

              {/* User avatar dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="ml-1 rounded-full ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    aria-label="Account menu"
                  >
                    <Avatar className="h-10 w-10 cursor-pointer ring-2 ring-brand-green/25 transition hover:ring-brand-green/50">
                      <AvatarFallback className="bg-brand-green-600 text-xs font-bold text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60 rounded-2xl p-1.5">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-semibold leading-none">
                        {finalDisplayName || "My Account"}
                      </p>
                      {email && (
                        <p className="truncate text-xs leading-none text-muted-foreground">
                          {email}
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" prefetch={false} className="cursor-pointer">
                        <LayoutDashboard className="mr-2 h-4 w-4" />
                        Dashboard
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/verification" prefetch={false} className="cursor-pointer">
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Verification
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard/settings" prefetch={false} className="cursor-pointer">
                        <Settings className="mr-2 h-4 w-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    {hasAdminAccess && (
                      <DropdownMenuItem asChild>
                        <Link href="/admin" prefetch={false} className="cursor-pointer">
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
              <Button asChild variant="ghost" size="sm" className="h-10 rounded-full px-4">
                <a href={LOGIN_HREF}>Sign in</a>
              </Button>
              <Button asChild variant="trust-verified" size="sm" className="h-10 rounded-full px-5">
                <a href={REGISTER_HREF}>Register</a>
              </Button>
            </>
          )}
        </div>

        {/* Mobile actions stay visible when the menu is closed. */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 lg:hidden">
          <Link
            href="/search"
            prefetch={false}
            aria-label="Search"
            className="flex h-10 w-10 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Link>
          {isAuthenticated && <NotificationBell userId={auth.user?.id} />}
          <button
            ref={mobileToggleRef}
            type="button"
            className="relative z-[120] flex h-11 w-11 items-center justify-center rounded-full p-2 touch-manipulation transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-controls="mobile-nav-menu"
            aria-expanded={mobileOpen}
            data-testid="mobile-menu-toggle"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Area navigation — the three product areas plus help links */}
      <div className="border-t border-border/50">
        <div className="container-page flex h-12 items-center gap-4">
          <div className="min-w-0 flex-1 lg:flex-none">
            <MarketplaceSwitcher />
          </div>
          <nav
            aria-label="Help and business"
            className="ml-auto hidden items-center gap-1 text-sm lg:flex"
          >
            {SECONDARY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <link.icon className="h-4 w-4" aria-hidden="true" />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Mobile Menu */}
      <nav
        id="mobile-nav-menu"
        aria-label="Mobile navigation"
        hidden={!mobileOpen}
        className={cn(
          "max-h-[calc(100dvh-7rem)] overflow-y-auto border-t border-border/60 bg-background lg:hidden",
          mobileOpen ? "animate-fade-in-up" : "hidden"
        )}
      >
        <div className="container-page space-y-5 py-4 pb-safe">
          {isAuthenticated ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3">
              <Avatar className="h-11 w-11 ring-2 ring-brand-green/25">
                <AvatarFallback className="bg-brand-green-600 text-sm font-bold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{finalDisplayName || "My Account"}</p>
                {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
              </div>
              {(trustLevelProp || auth.trustLevel) > 0 && (
                <TrustBadge level={trustLevelProp || auth.trustLevel} size="sm" />
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-brand-green-600 p-4 text-white dark:bg-brand-green-900/60">
              <p className="font-display text-lg font-bold leading-tight">
                Join South Africa&apos;s trust-first marketplace
              </p>
              <p className="mt-1 text-sm text-white/80">
                Free to join. Get verified and start posting in minutes.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  asChild
                  className="h-11 rounded-full bg-white text-brand-green-800 hover:bg-white/90"
                >
                  <a href={REGISTER_HREF} onClick={closeMobile}>
                    Register
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 rounded-full border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
                >
                  <a href={LOGIN_HREF} onClick={closeMobile}>
                    Sign in
                  </a>
                </Button>
              </div>
            </div>
          )}

          {isAuthenticated ? (
            <div className="space-y-1">
              <Button asChild variant="trust-verified" className="mb-2 h-12 w-full rounded-full">
                <Link href="/post/create" prefetch={false} onClick={closeMobile}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Post something
                </Link>
              </Button>
              <Link
                href="/dashboard"
                prefetch={false}
                className={mobileLinkClass}
                onClick={closeMobile}
              >
                <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
                Dashboard
              </Link>
              <Link
                href="/verification"
                prefetch={false}
                className={mobileLinkClass}
                onClick={closeMobile}
              >
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                Verification
              </Link>
              <Link
                href="/dashboard/settings"
                prefetch={false}
                className={mobileLinkClass}
                onClick={closeMobile}
              >
                <Settings className="h-5 w-5 text-muted-foreground" />
                Settings
              </Link>
              {hasAdminAccess && (
                <Link
                  href="/admin"
                  prefetch={false}
                  className={mobileLinkClass}
                  onClick={closeMobile}
                >
                  <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                  Admin
                </Link>
              )}
            </div>
          ) : null}

          <div>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Help &amp; business
            </p>
            {SECONDARY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className={mobileLinkClass}
                onClick={closeMobile}
              >
                <link.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                {link.label}
              </Link>
            ))}
            <Link
              href="/contact"
              prefetch={false}
              className={mobileLinkClass}
              onClick={closeMobile}
            >
              <MessageCircle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Contact support
            </Link>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card px-3 py-2">
            <span className="text-sm font-medium">Light / dark theme</span>
            {renderThemeToggle("relative")}
          </div>

          {isAuthenticated ? (
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-destructive disabled:opacity-50"
              disabled={signingOut}
              onClick={() => {
                closeMobile();
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
          ) : null}
        </div>
      </nav>
    </header>
  );
}
