import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { PageHeader } from "@/components/layout/page-header";
import { TrustStrip } from "@/components/layout/trust-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VERIFY_MZANSI_CATEGORY_SEO } from "@/lib/seo/public-categories";

type AdvertiseSurface = {
  name: string;
  description: string;
  browseHref: string;
  createHref: string;
  createLabel: string;
  secondaryCreateHref?: string;
  secondaryCreateLabel?: string;
};

export const metadata: Metadata = {
  title: "Advertise",
  description:
    "Advertise marketplace items, business services, tourism accommodation, experiences, venues, and events on VerifyMzansi.",
  alternates: {
    canonical: "https://verifymzansi.com/advertise",
  },
};

export default function AdvertisePage() {
  const surfaces: AdvertiseSurface[] = VERIFY_MZANSI_CATEGORY_SEO.map((category) => {
    if (category.id === "mzansi-market") {
      return {
        name: category.name,
        description: category.description,
        browseHref: category.href,
        createHref: "/post/create-listing",
        createLabel: "Create marketplace listing",
      };
    }

    if (category.id === "mzansi-business") {
      return {
        name: category.name,
        description: category.description,
        browseHref: category.href,
        createHref: "/post/create-business",
        createLabel: "Create business profile",
      };
    }

    return {
      name: category.name,
      description: category.description,
      browseHref: category.href,
      createHref: "/post/create-tourism",
      createLabel: "List tourism business",
      secondaryCreateHref: "/post/create-tourism?type=event",
      secondaryCreateLabel: "Create event",
    };
  });

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <section className="border-b border-border/60 bg-gradient-to-b from-brand-green-50/40 via-background to-background">
          <div className="container-page py-10 space-y-6 sm:py-14">
            <PageHeader
              title="Advertise on VerifyMzansi"
              description="Promote marketplace items, business services, tourism accommodation, experiences, venues, and events with trusted visibility."
              breadcrumbs={[{ label: "Advertise" }]}
            />

            <div className="max-w-3xl space-y-4 text-sm text-muted-foreground sm:text-base">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button asChild size="lg" className="gap-2">
                  <Link href="/post/create">
                    Choose a post type
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/pricing">View Pricing</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <TrustStrip variant="green" title="Trusted posting categories" />

        <section className="container-page py-6 space-y-5 sm:py-8">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Choose your posting category
            </h2>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {surfaces.map((surface) => (
              <Card key={surface.name}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    <BadgeCheck className="h-5 w-5 text-brand-green-600" />
                    {surface.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">{surface.description}</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button asChild className="w-full gap-2 sm:w-auto">
                      <Link href={surface.createHref}>
                        {surface.createLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full sm:w-auto">
                      <Link href={surface.browseHref}>
                        {surface.name === "Tourism & Events"
                          ? "Explore Tourism & Events"
                          : `Browse ${surface.name}`}
                      </Link>
                    </Button>
                    {surface.secondaryCreateHref && surface.secondaryCreateLabel && (
                      <Button asChild variant="outline" className="w-full gap-2 sm:w-auto">
                        <Link href={surface.secondaryCreateHref}>
                          {surface.secondaryCreateLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
