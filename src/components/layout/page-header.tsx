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
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
  centered,
}: PageHeaderProps) {
  if (centered) {
    return (
      <div className={cn("space-y-3 border-b pb-5", className)}>
        {breadcrumbs && (
          <div className="flex justify-center">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        )}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="text-muted-foreground text-sm leading-6 sm:text-base max-w-xl mx-auto">
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
    <div className={cn("space-y-3", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description && (
            <p className="text-muted-foreground text-sm leading-6 sm:text-base max-w-2xl">
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
