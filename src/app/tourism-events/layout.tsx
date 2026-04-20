import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";

export const metadata: Metadata = {
  title: "Tourism & Events",
  description: "Browse verified tourism destinations, accommodations, and events on VerifyMzansi.",
};

export default function TourismEventsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 pb-24 md:pb-0 scroll-mt-24">
        {children}
      </main>
      <Footer />
      <MobileNav />
    </div>
  );
}
