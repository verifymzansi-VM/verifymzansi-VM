"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { Menu, X, ShieldAlert, LayoutDashboard, Settings, LogOut, Sun, Moon } from "lucide-react";
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
import { TrustBadge } from "@/components/trust/trust-badge";
import { NotificationBell } from "@/components/notification-bell";
import { MarketplaceSwitcher } from "./marketplace-switcher";
import { useAuth } from "@/hooks/use-auth";
import type { TrustLevel } from "@/types/enums";

interface HeaderProps {
  /** Pass `true` to skip the session check (e.g. dashboard layout already knows). */
  isAuthenticated?: boolean;
  displayName?: string;
  trustLevel?: TrustLevel;
}

export function Header({
  isAuthenticated: isAuthProp,
  displayName: displayNameProp,
  trustLevel: trustLevelProp = 0,
}: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
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

  // Close mobile menu on Escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) setMobileOpen(false);
    },
    [mobileOpen]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [handleEscape]);

  async function handleSignOut() {
    await auth.signOut();
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background md:bg-background/95 md:backdrop-blur md:supports-[backdrop-filter]:bg-background/60">
      <div className="container-page flex h-16 items-center justify-between">
        <Link href="/" aria-label="VerifyMzansi — Home" className="flex items-center flex-shrink-0">
          <Image
            src="/images/logo-transparent.png"
            alt="VerifyMzansi — Verified Business of South Africa"
            width={800}
            height={228}
            className="w-48 sm:w-56 md:w-64 h-auto object-contain transition-transform hover:scale-105"
            priority
          />
        </Link>

        {/* Marketplace Switcher — hidden on mobile, shown md+ */}
        <div className="hidden md:flex items-center">
          <MarketplaceSwitcher />
        </div>

        {/* Desktop Right — Auth */}
        <div className="hidden md:flex items-center gap-2">
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
                    onSelect={(e) => {
                      e.preventDefault();
                      handleSignOut();
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button
                asChild
                variant="outline"
                className="border-brand-green border-2 hover:bg-brand-green/10"
                size="sm"
              >
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild variant="trust-verified" size="sm">
                <Link href="/register">Register</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Hamburger */}
        <button
          className="md:hidden p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen ? "true" : "false"}
          aria-controls="mobile-nav-menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Marketplace Tabs — always visible on mobile */}
      <div className="md:hidden w-full border-t bg-background/95">
        <div className="container-page flex items-center justify-around py-1.5">
          <MarketplaceSwitcher />
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <nav
          id="mobile-nav-menu"
          aria-label="Mobile navigation"
          className="md:hidden border-t bg-background animate-fade-in-up"
        >
          <div className="container-page py-4 space-y-4">
            <div className="flex flex-col gap-2">
              {isAuthenticated ? (
                <>
                  {/* Mobile user info */}
                  <div className="flex items-center gap-3 px-1 py-2">
                    <Avatar className="h-9 w-9 border-2 border-brand-gold">
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
                    className="flex items-center gap-2 py-2 text-sm font-medium"
                    onClick={() => setMobileOpen(false)}
                  >
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </Link>
                  <Link
                    href="/dashboard/settings"
                    className="flex items-center gap-2 py-2 text-sm font-medium"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </Link>
                  {hasAdminAccess && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 py-2 text-sm font-medium"
                      onClick={() => setMobileOpen(false)}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Admin
                    </Link>
                  )}
                  <Button asChild variant="trust-verified" className="w-full">
                    <Link href="/post/create" onClick={() => setMobileOpen(false)}>
                      + Post
                    </Link>
                  </Button>
                  <button
                    className="flex items-center gap-2 py-2 text-sm font-medium text-destructive"
                    onClick={() => {
                      setMobileOpen(false);
                      handleSignOut();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </>
              ) : (
                <>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/login" onClick={() => setMobileOpen(false)}>
                      Sign In
                    </Link>
                  </Button>
                  <Button asChild variant="trust-verified" className="w-full">
                    <Link href="/register" onClick={() => setMobileOpen(false)}>
                      Register
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
