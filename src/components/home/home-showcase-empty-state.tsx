import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmptyStateTone = "green" | "blue" | "teal";

const toneClasses: Record<
  EmptyStateTone,
  {
    iconClassName: string;
    buttonClassName: string;
  }
> = {
  green: {
    iconClassName:
      "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-200",
    buttonClassName: "bg-brand-green-600 text-white hover:bg-brand-green-700",
  },
  blue: {
    iconClassName:
      "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/15 dark:text-brand-blue-200",
    buttonClassName: "bg-brand-blue-600 text-white hover:bg-brand-blue-700",
  },
  teal: {
    iconClassName: "bg-sunset-500/10 text-sunset-700 dark:bg-sunset-500/15 dark:text-sunset-200",
    buttonClassName: "bg-sunset-700 text-white hover:bg-sunset-800",
  },
};

interface HomeShowcaseEmptyStateProps {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  tone: EmptyStateTone;
  icon: ReactNode;
}

export function HomeShowcaseEmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
  tone,
  icon,
}: HomeShowcaseEmptyStateProps) {
  const styles = toneClasses[tone];

  return (
    <div className="flex flex-col items-start gap-4 rounded-3xl border border-dashed border-border bg-card/70 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${styles.iconClassName}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-body text-base font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button asChild className={`h-11 shrink-0 rounded-full px-5 ${styles.buttonClassName}`}>
        <Link href={ctaHref} prefetch={false}>
          {ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
