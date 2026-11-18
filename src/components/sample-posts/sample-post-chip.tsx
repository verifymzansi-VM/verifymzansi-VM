import { SAMPLE_POST_LABEL } from "@/lib/sample-posts/label";
import { cn } from "@/lib/utils";

/**
 * "Sample post · for display only". Shown on every sample card and on the
 * sample page. Samples never carry trust badges: nothing about them was checked.
 */
export function SamplePostChip({ className }: { className?: string }) {
  return (
    <span
      data-sample-post-chip
      className={cn(
        "inline-flex max-w-full items-center rounded-full border border-brand-gold-300/40 bg-brand-green-950/90 px-2.5 py-1 text-[11px] font-semibold leading-tight text-brand-gold-200 shadow-md",
        className
      )}
    >
      {SAMPLE_POST_LABEL}
    </span>
  );
}
