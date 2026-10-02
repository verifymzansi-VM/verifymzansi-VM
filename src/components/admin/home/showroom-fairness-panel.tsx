import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  getShowroomExposureReport,
  type ShowroomSurfaceExposure,
  type ZeroExposurePost,
} from "@/lib/utils/admin-queries";
import { formatCount, SectionHeading } from "./home-cards";

const SURFACE_LABELS: Record<ShowroomSurfaceExposure["surface"], string> = {
  home: "Home",
  business: "Mzansi Business",
  market: "Mzansi Market",
  tourism: "Tourism & Events",
};

function postHref(post: ZeroExposurePost): string {
  if (post.table === "listings") return `/listing/${post.id}`;
  if (post.table === "promotions") return `/tourism-events/${post.id}`;
  return post.surface === "tourism" ? `/tourism-events/${post.id}` : `/mzansi-business/${post.id}`;
}

/**
 * Fair rotation health for staff. Every live post should get roughly the same
 * number of showroom appearances; posts nobody saw in a day are listed (the
 * ranking already moves them to the front).
 */
export async function ShowroomFairnessPanel() {
  const report = await getShowroomExposureReport();
  if (!report.available) {
    return (
      <section role="status" className="rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Showroom fairness unavailable</h2>
        <p className="text-xs text-muted-foreground">
          Check the fair rotation migration and database connection.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="home-showroom-fairness">
      <div id="home-showroom-fairness">
        <SectionHeading
          title="Showroom fairness"
          description="Viewable showroom appearances per live post over 7 days. Posts take turns: whoever has been seen least goes next, new posts get 72 hours up front, and local posts are offered first."
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {report.surfaces.map((surface) => (
          <div key={surface.surface} className="rounded-xl border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">
              {SURFACE_LABELS[surface.surface]}
            </p>
            <p className="font-display text-3xl font-bold tabular-nums tracking-tight">
              {surface.fairShare7d === null ? "—" : formatCount(surface.fairShare7d)}
            </p>
            <p className="text-xs text-muted-foreground">
              Fair share per post · {formatCount(surface.posts)} live posts · lowest{" "}
              {formatCount(surface.lowest7d)}, highest {formatCount(surface.highest7d)}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-4">
        {report.zeroExposure.length === 0 ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2
              className="h-4 w-4 text-brand-green-700 dark:text-brand-green-300"
              aria-hidden="true"
            />
            Every live post appeared in its showrooms in the last 24 hours.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
              {formatCount(report.zeroExposure.length)} showroom places with no appearance in 24
              hours
            </p>
            <p className="text-xs text-muted-foreground">
              These posts are now first in line. If one stays here, check that its media loads.
            </p>
            <ul className="divide-y text-sm">
              {report.zeroExposure.slice(0, 12).map((post) => (
                <li
                  key={`${post.surface}:${post.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
                >
                  <Link
                    className="min-w-0 truncate font-medium underline-offset-2 hover:underline"
                    href={postHref(post)}
                  >
                    {post.title}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {SURFACE_LABELS[post.surface]}
                    {post.province ? ` · ${post.province}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
