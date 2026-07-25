interface TrustStripProps {
  variant?: "green" | "blue";
  title?: string;
}

/**
 * Editorial section divider between the showroom and the browse grid.
 * Kept intentionally quiet: a small label and a hairline, not a banner.
 */
export function TrustStrip({
  variant = "green",
  title = "Latest on Mzansi Market",
}: TrustStripProps) {
  const titleClass =
    variant === "green"
      ? "text-brand-green-700 dark:text-brand-green-300"
      : "text-brand-blue dark:text-brand-blue-200";

  return (
    <section className="hidden sm:block border-b border-border/60">
      <div className="container-page flex items-center gap-4 py-3.5">
        <h2 className={`shrink-0 text-xs font-semibold uppercase tracking-[0.22em] ${titleClass}`}>
          {title}
        </h2>
        <div className="h-px flex-1 bg-border/70" aria-hidden="true" />
      </div>
    </section>
  );
}
