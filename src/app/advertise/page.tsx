import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Advertise on VerifyMzansi",
  description:
    "Advertise in Promotions & Events on VerifyMzansi for launches, deals, specials, and time-sensitive campaigns.",
  alternates: {
    canonical: "https://verifymzansi.com/promotions",
  },
};

export default function AdvertisePage() {
  permanentRedirect("/promotions");
}
