"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

type DeviceMode = "mobile" | "desktop";

interface DevicePreviewShellProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps any content in a device-frame (phone or desktop) with a toggle.
 *
 * - Mobile: iPhone-style portrait frame, 375 × 667 scaled container.
 * - Desktop: Browser window chrome, 1280 × 800 viewport.
 * Both use CSS transform scaling to fit the parent width.
 */
export function DevicePreviewShell({ children, className }: DevicePreviewShellProps) {
  const [device, setDevice] = useState<DeviceMode>("mobile");

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toggle bar */}
      <div
        className="flex items-center justify-center gap-2"
        role="group"
        aria-label="Preview device"
      >
        <button
          type="button"
          onClick={() => setDevice("mobile")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            device === "mobile"
              ? "bg-brand-blue text-white shadow-md"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <Smartphone className="h-4 w-4" />
          Mobile
        </button>
        <button
          type="button"
          onClick={() => setDevice("desktop")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors",
            device === "desktop"
              ? "bg-brand-blue text-white shadow-md"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          )}
        >
          <Monitor className="h-4 w-4" />
          Desktop
        </button>
      </div>

      {/* Device frame */}
      <div className="flex justify-center">
        {device === "mobile" ? (
          <MobileFrame>{children}</MobileFrame>
        ) : (
          <DesktopFrame>{children}</DesktopFrame>
        )}
      </div>
    </div>
  );
}

/* ─── Mobile (phone) frame ─── */
function MobileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[320px] sm:w-[375px]">
      {/* Phone chrome */}
      <div className="rounded-[2.5rem] border-[6px] border-gray-800 bg-gray-800 p-2 shadow-2xl dark:border-gray-600">
        {/* Notch */}
        <div className="mx-auto mb-2 h-6 w-28 rounded-full bg-gray-900 dark:bg-gray-700" />
        {/* Screen */}
        <div className="overflow-y-auto rounded-[1.5rem] bg-background max-h-[667px]">
          <div className="p-4">{children}</div>
        </div>
        {/* Home bar */}
        <div className="mx-auto mt-2 h-1.5 w-24 rounded-full bg-gray-600" />
      </div>
    </div>
  );
}

/* ─── Desktop (browser) frame ─── */
function DesktopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-4xl">
      {/* Browser chrome */}
      <div className="overflow-hidden rounded-xl border border-border shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-2 bg-gray-100 px-4 py-2.5 dark:bg-gray-800">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-400" />
            <span className="h-3 w-3 rounded-full bg-yellow-400" />
            <span className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1">
            <div className="mx-auto max-w-sm rounded-md bg-white px-3 py-1 text-center text-xs text-muted-foreground dark:bg-gray-700">
              verifymzansi.co.za/businesses/preview
            </div>
          </div>
        </div>
        {/* Viewport */}
        <div className="overflow-y-auto bg-background max-h-[600px]">
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
