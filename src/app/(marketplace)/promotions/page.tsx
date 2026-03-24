import type { Metadata } from "next";
import { PromotionsExplorer } from "./client";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Promote Products, Services & Events",
  description:
    "Promote products, services, launches, deals, and events with verification-first visibility across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/promotions`,
  },
};

export const revalidate = 60;

export default function PromotionsPage() {
  return <PromotionsExplorer />;
}
