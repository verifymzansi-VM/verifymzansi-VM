import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { BrandSurface } from "@/components/brand";
import { InstallPanel } from "./install-panel";

export const metadata: Metadata = {
  title: "Get the app",
  description:
    "Install VerifyMzansi on your Android phone or iPhone straight from your browser. No app store needed.",
  alternates: { canonical: "/install" },
};

export default function InstallPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 bg-background">
        <BrandSurface as="section">
          <div className="container-page pb-9 pt-6 sm:pb-11 sm:pt-8">
            <PageHeader
              title="Get the app"
              description="Install from your browser. No app store, no download."
              tone="inverse"
            />
          </div>
        </BrandSurface>
        <div className="container-page py-8 sm:py-10">
          <InstallPanel />
        </div>
      </main>
      <Footer />
    </div>
  );
}
