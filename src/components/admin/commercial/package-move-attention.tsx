import { formatDateTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { PackageMoveFailure } from "@/lib/foundation/package-move-failures";
import { AdminCard } from "./commercial-action";

const TITLES: Record<PackageMoveFailure["direction"], string> = {
  into_package: "Post could not move into the package",
  out_of_package: "Post could not move out of the package",
};

/**
 * "Needs attention" on the staff payments page: Multi-listing package moves
 * the minute sweep keeps failing to make. A stuck one (failing for over 30
 * minutes, or in the package's last day) also fails the operations job, so
 * the alert has fired. The sweep keeps retrying by itself. Nothing is shown
 * while nothing fails.
 */
export function PackageMoveAttention({ failures }: { failures: PackageMoveFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <AdminCard
      title="Needs attention"
      description="Moves are checked every minute. A post that never moves falls into the 3-day grace when its package ends."
    >
      <ul className="space-y-2 text-sm">
        {failures.map((failure) => (
          <li
            key={`${failure.package_id}:${failure.post_id ?? "package"}:${failure.direction}`}
            className={cn(
              "space-y-1 rounded-lg border p-3",
              failure.stuck
                ? "border-destructive/40 bg-destructive/5"
                : "border-brand-gold/40 bg-brand-gold/5"
            )}
          >
            <p className="font-medium">
              {failure.post_id ? TITLES[failure.direction] : "The package was busy"}
            </p>
            <p className="text-muted-foreground">
              {failure.post_title ? <>“{failure.post_title}” · </> : null}
              tried {failure.tries.toLocaleString("en-ZA")} {failure.tries === 1 ? "time" : "times"}{" "}
              since {formatDateTime(failure.first_failed_at)} · reason: {failure.reason}
            </p>
            <p className="text-xs text-muted-foreground">
              Package {failure.owner_name ? `of ${failure.owner_name}` : failure.package_id}
              {failure.package_ends_at
                ? ` · ends ${formatDateTime(failure.package_ends_at)} (SA time)`
                : " · ended or refunded"}
            </p>
          </li>
        ))}
      </ul>
    </AdminCard>
  );
}
