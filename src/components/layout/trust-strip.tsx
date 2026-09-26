import { Clock3, Flag, LockKeyhole, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrustStripProps {
  variant?: "green" | "blue";
  /** Accessible heading for the strip (visually hidden). */
  title?: string;
  className?: string;
}

const POINTS = [
  { icon: Smartphone, label: "Phone & ID checked" },
  { icon: Clock3, label: "Posts reviewed first" },
  { icon: LockKeyhole, label: "Secure Ozow payments" },
  { icon: Flag, label: "Easy reporting" },
] as const;

/**
 * Quiet band of the checks behind every post. Describes what we check, never
 * a guarantee. Wraps to two columns on phones.
 */
export function TrustStrip({
  variant = "green",
  title = "Why people trust posts here",
  className,
}: TrustStripProps) {
  const iconClass =
    variant === "green"
      ? "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300"
      : "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/20 dark:text-brand-blue-300";

  return (
    <section aria-label={title} className={cn("border-y border-border/60 bg-card/60", className)}>
      <ul className="container-page grid grid-cols-2 gap-x-4 gap-y-3 py-4 text-[13px] font-medium text-foreground/80 sm:text-sm lg:grid-cols-4">
        {POINTS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                iconClass
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
