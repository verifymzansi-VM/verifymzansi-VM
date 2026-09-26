import {
  Bone,
  DetailTitleSkeleton,
  HeaderSkeleton,
  LoadingRegion,
  SidebarCardSkeleton,
} from "@/components/shared/page-skeletons";

/** Listing detail: title, then gallery | price & description | seller columns. */
export default function ListingLoading() {
  return (
    <LoadingRegion label="Loading listing" className="min-h-screen bg-background">
      <HeaderSkeleton />
      <main id="main-content" className="container-page space-y-6 py-5 sm:py-7">
        <DetailTitleSkeleton />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)_minmax(0,300px)]">
          <div className="space-y-3">
            <Bone className="aspect-[4/5] w-full rounded-3xl" />
            <div className="flex gap-2">
              <Bone className="h-16 w-16 rounded-xl" />
              <Bone className="h-16 w-16 rounded-xl" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Bone className="h-6 w-28 rounded-full" />
              <Bone className="h-6 w-20 rounded-full" />
            </div>
            <Bone className="h-9 w-48 rounded-lg" />
            <Bone className="h-4 w-56 rounded-full" />
            <div className="surface-card space-y-2.5 p-5">
              <Bone className="h-6 w-40 rounded-lg" />
              <Bone className="h-3.5 w-full rounded-full" />
              <Bone className="h-3.5 w-full rounded-full" />
              <Bone className="h-3.5 w-2/3 rounded-full" />
            </div>
          </div>
          <SidebarCardSkeleton />
        </div>
      </main>
    </LoadingRegion>
  );
}
