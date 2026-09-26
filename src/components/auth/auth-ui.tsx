import type { ReactNode } from "react";
import { AlertCircle, LockKeyhole, Store } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { cn } from "@/lib/utils";

/**
 * Shared class for auth inputs: 48px tall on every breakpoint (comfortable to
 * tap, and never below the 44px e2e minimum) with 16px text so iOS Safari does
 * not zoom the page when a field gains focus.
 */
export const authInputClassName = "h-12 sm:h-12 rounded-xl text-base sm:text-[15px]";

/** Page heading block for auth screens: one h1 plus a short, helpful line. */
export function AuthPageHeader({
  title,
  description,
  icon,
  align = "start",
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  align?: "start" | "center";
}) {
  return (
    <div className={cn("space-y-2", align === "center" && "text-center")}>
      {icon ? (
        <div className={cn("mb-4 flex", align === "center" && "justify-center")}>{icon}</div>
      ) : null}
      <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-foreground sm:text-[2rem]">
        {title}
      </h1>
      {description ? (
        <p className="text-[15px] leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** "or use your email" rule between the Google button and the email form. */
export function AuthDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-[13px] font-medium text-muted-foreground">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Inline field error, linked to its input through `aria-describedby`. */
export function AuthFieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="inline-form-error flex items-start gap-1.5" role="alert">
      <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

/** Short helper line under a field (format examples, why we ask). */
export function AuthFieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-[13px] leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

const NOTICE_TONES = {
  success: {
    box: "border-brand-green/25 bg-brand-green-50 dark:border-brand-green/30 dark:bg-brand-green/10",
    icon: "bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950",
  },
  info: {
    box: "border-brand-blue/20 bg-brand-blue-50 dark:border-brand-blue/30 dark:bg-brand-blue/10",
    icon: "bg-brand-blue-600 text-white dark:bg-brand-blue-400 dark:text-brand-blue-950",
  },
  warning: {
    box: "border-brand-gold/40 bg-brand-gold-50 dark:border-brand-gold/30 dark:bg-brand-gold/10",
    icon: "bg-brand-gold text-brand-gold-950",
  },
} as const;

/** Callout used for confirmation / status messages above auth forms. */
export function AuthNotice({
  tone = "success",
  icon,
  title,
  children,
  role,
  className,
}: {
  tone?: keyof typeof NOTICE_TONES;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  const styles = NOTICE_TONES[tone];

  return (
    <div
      role={role}
      aria-live={role === "status" ? "polite" : undefined}
      className={cn("flex items-start gap-3 rounded-2xl border p-4", styles.box, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&_svg]:h-[18px] [&_svg]:w-[18px]",
          styles.icon
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[15px] font-semibold text-foreground">{title}</p>
        {children ? (
          <div className="space-y-3 text-sm leading-6 text-foreground/75">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

const ICON_TILE_TONES = {
  green: "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300",
  gold: "bg-brand-gold/15 text-brand-gold-800 dark:text-brand-gold-300",
  red: "bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300",
} as const;

/** Large icon tile shown above the heading on single-purpose auth screens. */
export function AuthIconTile({
  tone = "green",
  children,
}: {
  tone?: keyof typeof ICON_TILE_TONES;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
        ICON_TILE_TONES[tone]
      )}
    >
      {children}
    </span>
  );
}

const REASSURANCE = [
  { icon: Store, text: "Free to join" },
  { icon: BrandShield, text: "ID checks only to post" },
  { icon: LockKeyhole, text: "Documents kept private" },
] as const;

/**
 * Compact trust chips for phones and tablets, where the desktop brand panel is
 * hidden. Shown under the sign-in and sign-up forms.
 */
export function AuthReassurance() {
  return (
    <ul className="flex flex-wrap justify-center gap-2 lg:hidden">
      {REASSURANCE.map(({ icon: Icon, text }) => (
        <li
          key={text}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          <Icon
            className="h-3.5 w-3.5 text-brand-green-700 dark:text-brand-green-300"
            aria-hidden="true"
          />
          {text}
        </li>
      ))}
    </ul>
  );
}
