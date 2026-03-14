import type { Metadata } from "next";
import { PromotionsExplorer } from "./client";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Promotions & Events",
  description:
    "Advertise and discover time-sensitive offers, launches, specials, and events from verified South African businesses.",
  alternates: {
    canonical: `${BASE_URL}/promotions`,
  },
};

export const revalidate = 60;

export default function PromotionsPage() {
  return <PromotionsExplorer />;
}
