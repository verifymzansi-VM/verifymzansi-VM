"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { BRAND_SHIELD_LARGE_SRC, BrandMark } from "@/components/brand";
import { SaFlagStripe } from "@/components/brand/sa-flag-stripe";
import { Button } from "@/components/ui/button";

// Full-screen viewers cover the page and have their own controls.
const BANNER_BLOCKED_PATH_PREFIXES = ["/video-mode"];

// Tab storage: closing the tab (or the browser) forgets it, so the pop-up shows
// again the next time the site is opened, but not on every page or reload.
const CLOSED_STORAGE_KEY = "vm-prelaunch-banner-closed";

/** A short pause after the page appears, so the pop-up pops in on top of it. */
const POP_UP_DELAY_MS = 300;

function wasClosedInThisTab() {
  try {
    return window.sessionStorage.getItem(CLOSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberClosed() {
  try {
    window.sessionStorage.setItem(CLOSED_STORAGE_KEY, "1");
  } catch {
    // Storage can be blocked; the pop-up then shows again on the next full load.
  }
}

/**
 * Full-screen "Launching soon" pop-up shown each time a visitor opens the site.
 * Escape, the close button or "Explore the site" closes it for the rest of that
 * visit; the site works normally behind it.
 */
export function PrelaunchBanner() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const blocked = BANNER_BLOCKED_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix));

  // Open just after hydration, so it arrives on a settled page.
  useEffect(() => {
    if (blocked || wasClosedInThisTab()) return;
    const timer = window.setTimeout(() => setOpen(true), POP_UP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  // The page behind doesn't scroll while the pop-up is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (blocked) return null;

  return (
    // Not modal: a modal marks the rest of the page aria-hidden, which breaks the
    // hydration of streamed sections that arrive while it is open. The overlay
    // below covers the page instead, and Escape or a click outside closes it.
    <DialogPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        rememberClosed();
        setOpen(false);
      }}
    >
      <DialogPrimitive.Portal>
        {open ? (
          <div
            aria-hidden="true"
            data-full-screen-popup
            className="fixed inset-0 z-[90] animate-in fade-in-0 bg-brand-green-950/85"
          />
        ) : null}
        <DialogPrimitive.Content className="brand-alive fixed left-1/2 top-1/2 z-[90] w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-brand-green-950 text-white shadow-2xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 focus:outline-none">
          <div
            aria-hidden="true"
            className="brand-aurora absolute -inset-[12%] -z-10 bg-[radial-gradient(ellipse_at_top,rgba(249,168,38,0.18),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(8,98,74,0.45),transparent_60%)]"
          />
          <div
            aria-hidden="true"
            className="mzansi-pattern pointer-events-none absolute inset-0 -z-10 opacity-[0.07] invert"
          />

          <div className="flex min-h-0 flex-col items-center overflow-y-auto overscroll-contain px-6 pb-10 pt-8 text-center [scrollbar-width:thin] sm:px-8 [@media(max-height:640px)]:pt-6">
            <Image
              src={BRAND_SHIELD_LARGE_SRC}
              alt=""
              aria-hidden="true"
              width={112}
              height={112}
              unoptimized
              className="h-24 w-24 shrink-0 drop-shadow-[0_10px_30px_rgba(249,168,38,0.35)] sm:h-28 sm:w-28 [@media(max-height:640px)]:h-16 [@media(max-height:640px)]:w-16"
            />
            <BrandMark inverse decorative size="sm" className="mt-4" />

            <DialogPrimitive.Title className="mt-6 font-display text-[2rem] font-bold leading-[1.05] tracking-[-0.03em] text-white sm:text-4xl">
              We&apos;re launching <span className="gold-shine text-brand-gold-300">soon.</span>
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-3 max-w-sm text-base leading-7 text-white/75">
              You&apos;re viewing an early preview of VerifyMzansi. Everything already works, so
              feel free to look around and join in.
            </DialogPrimitive.Description>

            <DialogPrimitive.Close asChild>
              <Button
                size="lg"
                className="mt-7 h-12 w-full bg-brand-gold-300 text-base font-semibold text-brand-gold-950 hover:bg-brand-gold-200 sm:w-auto sm:px-10"
              >
                Explore the site
              </Button>
            </DialogPrimitive.Close>
            <p className="mt-3 hidden text-xs text-white/60 sm:block">
              Or press{" "}
              <kbd className="rounded border border-white/25 px-1.5 py-0.5 font-sans">Esc</kbd>
            </p>
          </div>

          <DialogPrimitive.Close
            aria-label="Close"
            title="Close"
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
          <SaFlagStripe className="absolute inset-x-0 bottom-0" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
