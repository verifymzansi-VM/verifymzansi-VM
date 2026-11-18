import { requireStaff } from "@/lib/auth/require-staff";
import { PageHeader } from "@/components/layout/page-header";
import { samplePostsEnabled } from "@/lib/sample-posts/catalogue";
import { readHiddenSampleSlugs } from "@/lib/sample-posts/hidden";
import { listCatalogueSamples } from "@/lib/sample-posts/load";
import { SamplePostsClient, type StaffSampleRow } from "./sample-posts-client";

export const metadata = {
  title: "Sample posts — Admin",
  description: "Remove or restore the display-only sample posts in the showrooms.",
};
export const dynamic = "force-dynamic";

export default async function SamplePostsAdminPage() {
  const { user } = await requireStaff("queue:view");
  const samples = await listCatalogueSamples();
  // Read fresh (not the 30-second public copy); null when it cannot be read.
  const hidden = await readHiddenSampleSlugs().catch(() => null);
  const rows: StaffSampleRow[] = samples.map((sample) => ({
    slug: sample.slug,
    title: sample.title,
    area: sample.area,
    place: `${sample.city}, ${sample.province}`,
    posterUrl: sample.posterUrl,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sample posts"
        description="Display-only examples shown after real posts in the showrooms."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Sample posts" }]}
      />
      <SamplePostsClient
        key={user.id}
        samples={rows}
        initialHidden={hidden ? [...hidden] : null}
        switchedOn={samplePostsEnabled()}
      />
    </div>
  );
}
