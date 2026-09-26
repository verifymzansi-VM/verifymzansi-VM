import {
  Bone,
  DetailTitleSkeleton,
  LoadingRegion,
  SidebarCardSkeleton,
} from "@/components/shared/page-skeletons";

/** Business profile: title, then media | about | poster/enquiry columns. */
export default function BusinessDetailLoading() {
  return (
    <LoadingRegion label="Loading business" className="container-page space-y-6 py-5 sm:py-7">
      <DetailTitleSkeleton />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,320px)]">
        <div className="space-y-3">
          <Bone className="aspect-[4/5] w-full rounded-3xl" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Bone key={i} className="h-20 w-16 rounded-xl" />
            ))}
          </div>
        </div>
        <div className="surface-card space-y-4 p-5 sm:p-6">
          <Bone className="h-6 w-48 rounded-lg" />
          <Bone className="h-6 w-28 rounded-full" />
          <Bone className="h-4 w-40 rounded-full" />
          <div className="space-y-2">
            <Bone className="h-3.5 w-full rounded-full" />
            <Bone className="h-3.5 w-full rounded-full" />
            <Bone className="h-3.5 w-2/3 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Bone className="h-14 rounded-2xl" />
            <Bone className="h-14 rounded-2xl" />
          </div>
        </div>
        <div className="space-y-4">
          <SidebarCardSkeleton lines={2} />
        </div>
      </div>
    </LoadingRegion>
  );
}
