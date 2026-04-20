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
    buttonClassName: "bg-brand-green text-white hover:bg-brand-green-600",
  },
  blue: {
    iconClassName:
      "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/15 dark:text-brand-blue-200",
    buttonClassName: "bg-brand-blue text-white hover:bg-brand-blue/90",
  },
  teal: {
    iconClassName: "bg-teal-500/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200",
    buttonClassName: "bg-teal-700 text-white hover:bg-teal-800",
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
    <div className="rounded-[1.5rem] border border-dashed border-slate-300/70 bg-white/70 p-8 text-center shadow-inner dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full ${styles.iconClassName}`}
        >
          {icon}
        </div>
        <p className="font-medium text-slate-900 dark:text-white">{title}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>
        <Button asChild size="sm" className={`rounded-full px-5 ${styles.buttonClassName}`}>
          <Link href={ctaHref} prefetch={false}>
            {ctaLabel}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
