import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Promotions & Events",
  description:
    "Discover promotions, launches, deals, and events from verified businesses and members across South Africa.",
  alternates: {
    canonical: "https://verifymzansi.com/promotions",
  },
};

export default function AdvertisePage() {
  permanentRedirect("/promotions");
}
