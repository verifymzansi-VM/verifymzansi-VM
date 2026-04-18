import { notFound } from "next/navigation";
import { AutoScrollRail } from "@/components/home/auto-scroll-rail";
import { PosterCardShell } from "@/components/listings/poster-card-shell";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const railItems = [
  {
    id: "rail-1",
    href: "/listing/rail-1",
    title: "Rail Test One",
    description: "First deterministic rail card",
    location: "Johannesburg",
    eyebrow: "Featured",
  },
  {
    id: "rail-2",
    href: "/listing/rail-2",
    title: "Rail Test Two",
    description: "Second deterministic rail card",
    location: "Cape Town",
    eyebrow: "Verified",
  },
  {
    id: "rail-3",
    href: "/listing/rail-3",
    title: "Rail Test Three",
    description: "Third deterministic rail card",
    location: "Durban",
    eyebrow: "New",
  },
  {
    id: "rail-4",
    href: "/listing/rail-4",
    title: "Rail Test Four",
    description: "Fourth deterministic rail card",
    location: "Pretoria",
    eyebrow: "Live",
  },
  {
    id: "rail-5",
    href: "/listing/rail-5",
    title: "Rail Test Five",
    description: "Fifth deterministic rail card",
    location: "Richards Bay",
    eyebrow: "Open",
  },
];

export default function RailDragPage() {
  if (!isPlaywrightTestMode()) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4">
        <div className="max-w-2xl text-white">
          <h1 className="text-2xl font-semibold">Rail Drag Test</h1>
          <p className="text-sm text-white/70">
            This page keeps the homepage-style showcase rail deterministic for browser drag
            verification.
          </p>
        </div>
        <AutoScrollRail
          ariaLabel="Rail drag showcase"
          showEdgeFades={false}
          flushEdges
          intervalMs={600_000}
          pauseAfterInteractionMs={5_000}
        >
          {railItems.map((item) => (
            <div
              key={item.id}
              className="h-full min-w-[210px] max-w-[272px] sm:min-w-[228px] sm:max-w-[296px] lg:min-w-[248px] lg:max-w-[320px]"
            >
              <PosterCardShell
                href={item.href}
                title={item.title}
                description={item.description}
                location={item.location}
                eyebrow={item.eyebrow}
                mediaUrl="/images/fallbacks/hero-shop.svg"
                logoUrl="/images/logo.png"
                cardVariant="showcase"
                disableNativeDrag
              />
            </div>
          ))}
        </AutoScrollRail>
      </div>
    </main>
  );
}
