import { cn } from "@/lib/utils";

/** Decorative placeholder; the wrapper announces loading once. */
function Bone({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-md skeleton-shimmer", className)} />;
}

export default function DsarLoading() {
  return (
    <div className="container-page space-y-8 py-6 sm:py-10" role="status" aria-busy="true">
      <div className="space-y-3">
        <Bone className="h-4 w-40" />
        <Bone className="h-9 w-72 max-w-full" />
        <Bone className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-10">
        <div className="hero-panel space-y-5 p-5 sm:p-8">
          <Bone className="h-7 w-48" />
          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Bone key={index} className="h-14 rounded-xl" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Bone className="h-4 w-28" />
              <Bone className="h-11 rounded-xl" />
            </div>
          ))}
          <Bone className="h-12 rounded-xl" />
        </div>
        <Bone className="h-64 rounded-2xl" />
      </div>
      <span className="sr-only">Loading the data request form…</span>
    </div>
  );
}
