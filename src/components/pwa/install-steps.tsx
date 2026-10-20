"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Share,
  SquarePlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { chromeIntentUrl, isAndroid } from "@/lib/pwa/install-environment";

type Step = { icon: LucideIcon; text: string };

const IOS_STEPS: Step[] = [
  { icon: Share, text: "Tap Share" },
  { icon: SquarePlus, text: "Tap Add to Home Screen" },
  { icon: Check, text: "Tap Add" },
];

const ANDROID_STEPS: Step[] = [
  { icon: EllipsisVertical, text: "Tap the menu (⋮)" },
  { icon: SquarePlus, text: "Tap Install app or Add to Home screen" },
  { icon: Check, text: "Tap Install" },
];

const DESKTOP_STEPS: Step[] = [
  { icon: Download, text: "Click the install icon in the address bar" },
  { icon: Check, text: "Click Install" },
];

function inAppSteps(android: boolean): Step[] {
  return [
    { icon: android ? EllipsisVertical : Ellipsis, text: "Tap the app's menu (⋮ or •••)" },
    {
      icon: ExternalLink,
      text: android ? "Tap Open in browser" : "Tap Open in Safari or Open in browser",
    },
    { icon: SquarePlus, text: "Then follow the steps there" },
  ];
}

function InstallStepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map(({ icon: Icon, text }, index) => (
        <li key={text} className="flex items-center gap-3 text-sm">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-gold-300">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span>
            <span className="sr-only">Step {index + 1}: </span>
            {text}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function IOSInstallSteps() {
  return <InstallStepList steps={IOS_STEPS} />;
}

/** Manual steps when the browser has not offered its install prompt. */
export function BrowserInstallSteps({ android }: { android: boolean }) {
  return <InstallStepList steps={android ? ANDROID_STEPS : DESKTOP_STEPS} />;
}

/** Steps for WhatsApp/Facebook/etc. in-app browsers, which cannot install apps. */
export function InAppInstallSteps({ pageUrl }: { pageUrl: string }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const nav = typeof navigator === "undefined" ? null : navigator;
  const android = nav ? isAndroid(nav) : false;
  const intentUrl = nav ? chromeIntentUrl(pageUrl, nav) : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopy("copied");
    } catch {
      // Some in-app browsers block the clipboard; show the link to copy by hand.
      setCopy("failed");
    }
  };

  return (
    <div className="space-y-4">
      {intentUrl ? (
        <Button asChild className="w-full rounded-full">
          <a href={intentUrl}>
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Open in Chrome
          </a>
        </Button>
      ) : null}
      <InstallStepList steps={inAppSteps(android)} />
      <Button size="sm" variant="outline" onClick={copyLink} className="rounded-full">
        {copy === "copied" ? (
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
        )}
        {copy === "copied" ? "Copied" : "Copy link"}
      </Button>
      {copy === "failed" ? (
        <input
          readOnly
          value={pageUrl}
          aria-label="Link to open in your browser"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm"
        />
      ) : null}
    </div>
  );
}
