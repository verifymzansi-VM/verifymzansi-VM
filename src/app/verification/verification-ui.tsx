"use client";

import Link from "next/link";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  EyeOff,
  Info,
  LifeBuoy,
  Lock,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { TrustBadge } from "@/components/trust/trust-badge";
import { cn } from "@/lib/utils";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

/* ── Overall status ────────────────────────────────────────────────────── */

export type OverallVerificationState =
  "not_started" | "in_progress" | "pending" | "verified" | "attention";

const OVERALL_STATE_COPY: Record<
  OverallVerificationState,
  { label: string; className: string; icon: IconType }
> = {
  not_started: {
    label: "Not started",
    className: "border-border bg-muted text-foreground/80",
    icon: Info,
  },
  in_progress: {
    label: "In progress",
    className:
      "border-brand-green-600/20 bg-brand-green-50 text-brand-green-800 dark:border-brand-green-400/25 dark:bg-brand-green-500/10 dark:text-brand-green-200",
    icon: Clock3,
  },
  pending: {
    label: "Submitted – pending review",
    className:
      "border-brand-gold-300/70 bg-brand-gold-50 text-brand-gold-900 dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10 dark:text-brand-gold-100",
    icon: Clock3,
  },
  verified: {
    label: "Verified",
    className:
      "border-brand-green-600/25 bg-brand-green-600 text-white dark:border-brand-green-400/30 dark:bg-brand-green-500 dark:text-brand-green-950",
    icon: ShieldCheck,
  },
  attention: {
    label: "Needs attention",
    className:
      "border-brand-red-600/25 bg-brand-red-50 text-brand-red-800 dark:border-brand-red-400/30 dark:bg-brand-red-500/15 dark:text-brand-red-200",
    icon: AlertTriangle,
  },
};

export function OverallStatusPill({
  state,
  className,
}: {
  state: OverallVerificationState;
  className?: string;
}) {
  const { label, className: toneClass, icon: Icon } = OVERALL_STATE_COPY[state];
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold sm:text-sm",
        toneClass,
        className
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <span className="sr-only">Verification status: </span>
        {label}
      </span>
    </span>
  );
}

/* ── Callouts ──────────────────────────────────────────────────────────── */

export type CalloutTone = "success" | "pending" | "attention" | "neutral";

const CALLOUT_TONES: Record<CalloutTone, { box: string; icon: string; Icon: IconType }> = {
  success: {
    box: "border-brand-green-600/20 bg-brand-green-50 text-brand-green-900 dark:border-brand-green-400/20 dark:bg-brand-green-500/10 dark:text-brand-green-100",
    icon: "bg-brand-green-600/10 text-brand-green-700 dark:bg-brand-green-400/15 dark:text-brand-green-300",
    Icon: CheckCircle2,
  },
  pending: {
    box: "border-brand-gold-300/70 bg-brand-gold-50 text-brand-gold-900 dark:border-brand-gold-400/25 dark:bg-brand-gold-400/10 dark:text-brand-gold-100",
    icon: "bg-brand-gold-400/20 text-brand-gold-800 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
    Icon: Clock3,
  },
  attention: {
    box: "border-brand-red-600/20 bg-brand-red-50 text-brand-red-800 dark:border-brand-red-400/25 dark:bg-brand-red-500/10 dark:text-brand-red-100",
    icon: "bg-brand-red-600/10 text-brand-red-700 dark:bg-brand-red-400/15 dark:text-brand-red-300",
    Icon: AlertTriangle,
  },
  neutral: {
    box: "border-border bg-muted/60 text-foreground",
    icon: "bg-card text-muted-foreground",
    Icon: Info,
  },
};

export function StatusCallout({
  tone,
  title,
  children,
  icon,
  className,
  role,
}: {
  tone: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: IconType;
  className?: string;
  role?: "status" | "alert";
}) {
  const toneStyles = CALLOUT_TONES[tone];
  const Icon = icon ?? toneStyles.Icon;
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-3.5 sm:p-4",
        toneStyles.box,
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          toneStyles.icon
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1 pt-1 text-sm leading-6">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/* ── Step card ─────────────────────────────────────────────────────────── */

export function StepCard({
  id,
  stepNumber,
  totalSteps = 4,
  title,
  icon: Icon,
  why,
  children,
  className,
}: {
  id: string;
  stepNumber: number;
  totalSteps?: number;
  title: string;
  icon: IconType;
  /** One short reassurance line, specific to this step. */
  why: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("surface-card overflow-hidden", className)}>
      <div className="p-4 pb-3 sm:p-6 sm:pb-4">
        <div className="flex items-center gap-3.5 sm:gap-4">
          <span
            aria-hidden="true"
            className="area-market-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12"
          >
            <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            {/* The accessible name stays "Step N: Title" — e2e journeys find steps by it. */}
            <h2 id={id} aria-label={`Step ${stepNumber}: ${title}`} className="font-body">
              <span className="block text-xs font-semibold text-brand-green-700 dark:text-brand-green-300 sm:text-sm">
                Step {stepNumber} of {totalSteps}
              </span>{" "}
              <span className="mt-0.5 block font-display text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
                {title}
              </span>
            </h2>
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <Lock
            className="mt-1 h-4 w-4 shrink-0 text-brand-green-700 dark:text-brand-green-300"
            aria-hidden="true"
          />
          {why}
        </p>
      </div>
      <div className="space-y-5 border-t border-border/60 p-4 sm:p-6">{children}</div>
    </section>
  );
}

/** Label + hint pair for a group of inputs inside a step. */
export function FieldGroupHeading({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div>
      <h3 className="font-body text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Back / primary action row. Stacks on phones so the primary action is full-width. */
export function StepActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

/* ── Aside panels ──────────────────────────────────────────────────────── */

const PRIVACY_POINTS: { icon: IconType; title: string }[] = [
  { icon: Lock, title: "Encrypted and access-logged" },
  { icon: EyeOff, title: "ID and selfie never shown publicly" },
  { icon: Scale, title: "Handled under POPIA" },
];

export function PrivacyPanel() {
  return (
    <section aria-labelledby="verification-privacy-title" className="surface-card p-4 sm:p-5">
      <h2
        id="verification-privacy-title"
        className="flex items-center gap-2 font-body text-base font-bold text-foreground"
      >
        <BrandShield className="h-5 w-5" />
        Your privacy
      </h2>
      <ul className="mt-3 space-y-2.5">
        {PRIVACY_POINTS.map(({ icon: Icon, title }) => (
          <li key={title} className="flex items-center gap-3 text-sm text-foreground/85">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70"
            >
              <Icon className="h-4 w-4" />
            </span>
            {title}
          </li>
        ))}
      </ul>
      <Link
        href="/privacy"
        prefetch={false}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
      >
        Privacy policy
      </Link>
    </section>
  );
}

export function WhatHappensNextPanel({ verified = false }: { verified?: boolean }) {
  const items = verified
    ? ["Your badge shows on your profile and posts", "Update your details if they change"]
    : ["Finish the four checks", "Our team reviews them", "Your badge appears"];

  return (
    <section aria-labelledby="verification-next-title" className="surface-card p-4 sm:p-5">
      <h2 id="verification-next-title" className="font-body text-base font-bold text-foreground">
        What happens next
      </h2>
      <ol className="mt-3 space-y-2.5">
        {items.map((item, index) => (
          <li key={item} className="flex items-center gap-3 text-sm text-foreground/85">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green-600/10 text-xs font-bold text-brand-green-700 dark:bg-brand-green-400/15 dark:text-brand-green-300"
            >
              {index + 1}
            </span>
            {item}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted/70 px-3 py-2.5">
        <TrustBadge level={3} size="md" />
        <span className="text-xs text-muted-foreground">Checks done, not a guarantee.</span>
      </div>
    </section>
  );
}

export function HelpLinkCard() {
  return (
    <Link
      href="/help/verification"
      prefetch={false}
      className="surface-card flex min-h-11 items-center gap-3 p-4 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/70"
      >
        <LifeBuoy className="h-5 w-5" />
      </span>
      <span className="text-sm font-semibold text-foreground">Stuck? Get verification help</span>
    </Link>
  );
}
