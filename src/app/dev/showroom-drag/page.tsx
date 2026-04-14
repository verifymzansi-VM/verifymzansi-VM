import { notFound } from "next/navigation";
import {
  ShowroomCardCarousel,
  type CarouselItem,
} from "@/components/showrooms/showroom-card-carousel";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const demoItems: CarouselItem[] = [
  {
    id: "drag-1",
    type: "listing",
    href: "/listing/drag-1",
    title: "Drag Test One",
    description: "First showroom drag card",
    location: "Johannesburg",
    mediaUrl: "/images/fallbacks/showroom-drag.mp4",
    posterUrl: "/images/fallbacks/hero-shop.svg",
    logoUrl: "/images/logo.png",
    eyebrow: "R 120 000",
  },
  {
    id: "drag-2",
    type: "listing",
    href: "/listing/drag-2",
    title: "Drag Test Two",
    description: "Second showroom drag card",
    location: "Cape Town",
    mediaUrl: "/images/fallbacks/hero-shop.svg",
    logoUrl: "/images/logo.png",
    eyebrow: "R 98 000",
  },
  {
    id: "drag-3",
    type: "promotion",
    href: "/promotion/drag-3",
    title: "Drag Test Three",
    description: "Third showroom drag card",
    location: "Durban",
    mediaUrl: "/images/fallbacks/hero-shop.svg",
    logoUrl: "/images/logo.png",
    eyebrow: "Featured",
  },
];

export default function ShowroomDragPage() {
  if (!isPlaywrightTestMode()) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-950 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4">
        <div className="max-w-2xl text-white">
          <h1 className="text-2xl font-semibold">Showroom Drag Test</h1>
          <p className="text-sm text-white/70">
            This page keeps the showroom carousel deterministic for browser drag verification.
          </p>
        </div>
        <ShowroomCardCarousel items={demoItems} pauseOnInteractionMs={5_000} />
      </div>
    </main>
  );
}
