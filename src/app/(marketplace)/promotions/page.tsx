import type { Metadata } from "next";
import { PromotionsExplorer } from "./client";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Promotions & Events",
  description:
    "Discover promotions, launches, deals, and events from verified businesses and members across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/promotions`,
  },
};

export const revalidate = 60;

export default function PromotionsPage() {
  return <PromotionsExplorer />;
}
