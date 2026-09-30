import { cn } from "@/lib/utils";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  children?: React.ReactNode;
  className?: string;
  /** Center-align the header with stacked layout — ideal for marketplace pages */
  centered?: boolean;
  /** "inverse" when the header sits on a dark-green BrandSurface. */
  tone?: "default" | "inverse";
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
  centered,
  tone = "default",
}: PageHeaderProps) {
  const inverse = tone === "inverse";
  const muted = inverse ? "text-white/75" : "text-muted-foreground";

  if (centered) {
    return (
      <div className={cn("space-y-4 border-b border-border/50 pb-8", className)}>
        {breadcrumbs && (
          <div className="flex justify-center">
            <Breadcrumbs items={breadcrumbs} tone={tone} />
          </div>
        )}
        <div className="flex flex-col items-center gap-3.5 text-center">
          <div className="space-y-2.5">
            <h1
              className={cn(
                "font-display text-3xl font-bold leading-[1.1] tracking-tight sm:text-[2.6rem]",
                inverse && "text-white"
              )}
            >
              {title}
            </h1>
            {description && (
              <p
                className={cn(
                  "mx-auto max-w-xl text-sm leading-6 sm:text-base sm:leading-7",
                  muted
                )}
              >
                {description}
              </p>
            )}
          </div>
          {children && <div className="flex items-center gap-2 pt-2">{children}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} tone={tone} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2 min-w-0">
          <h1
            className={cn(
              "font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight sm:text-[2.25rem]",
              inverse && "text-white"
            )}
          >
            {title}
          </h1>
          {description && (
            <p className={cn("max-w-2xl text-sm leading-6 sm:text-base sm:leading-7", muted)}>
              {description}
            </p>
          )}
        </div>
        {children && (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
