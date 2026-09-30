import { Skeleton } from "@/components/ui/skeleton";

/**
 * Rendered inside the auth layout's form card, so it only mirrors the form:
 * heading, Google button, two fields and the submit button.
 */
export default function AuthLoading() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div aria-hidden="true" className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-4 w-full max-w-xs" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="mx-auto h-3 w-40" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}
