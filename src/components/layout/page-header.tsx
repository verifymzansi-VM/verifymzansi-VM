import { cn } from "@/lib/utils";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {description && (
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">{description}</p>
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
