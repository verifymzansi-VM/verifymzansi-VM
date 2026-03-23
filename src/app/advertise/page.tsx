import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Megaphone, ShieldCheck, Store } from "lucide-react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { PageHeader } from "@/components/layout/page-header";
import { TrustStrip } from "@/components/layout/trust-strip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Advertise",
  description:
    "Advertise products, services, and events with verification-first visibility that helps South African customers discover your brand with confidence.",
  alternates: {
    canonical: "https://verifymzansi.com/advertise",
  },
};

export default function AdvertisePage() {
  const pillars = [
    {
      title: "Promote what matters now",
      description:
        "Launch products, spotlight services, and push seasonal campaigns from one trusted platform.",
      icon: Megaphone,
    },
    {
      title: "Build customer confidence",
      description:
        "Verification signals and trust badges help serious buyers feel more comfortable engaging with your brand.",
      icon: ShieldCheck,
    },
    {
      title: "Grow your business presence",
      description:
        "Create a stronger storefront for your business, campaigns, and featured offers across VerifyMzansi surfaces.",
      icon: Store,
    },
  ];

  const surfaces = [
    {
      name: "Mzansi Market",
      description: "Promote individual products, offers, and listings.",
      href: "/mzansi-market",
    },
    {
      name: "Mzansi Business",
      description: "Build a business profile that supports discovery and trust.",
      href: "/mzansi-business",
    },
    {
      name: "Promotions & Events",
      description: "Run launches, campaigns, specials, and event pushes with urgency.",
      href: "/promotions",
    },
  ];

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <section className="border-b border-border/60 bg-gradient-to-b from-brand-green-50/40 via-background to-background">
          <div className="container-page py-10 space-y-6 sm:py-14">
            <PageHeader
              title="Advertise on VerifyMzansi"
              description="Promote products, services, and campaigns with verification-first visibility that helps customers discover your brand with more confidence."
              breadcrumbs={[{ label: "Advertise" }]}
            >
              <Button asChild className="gap-2">
                <Link href="/pricing">
                  View pricing
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </PageHeader>

            <div className="max-w-3xl space-y-4 text-sm text-muted-foreground sm:text-base">
              <p>
                VerifyMzansi is built for businesses, sellers, and campaign owners who need reach
                without losing trust. Use the platform to improve visibility, reinforce credibility,
                and connect with customers across South Africa.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="gap-2">
                  <Link href="/register">
                    Create your account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/promotions">Explore promotions</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <TrustStrip variant="green" />

        <section className="container-page py-8 space-y-6 sm:py-10">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Why advertise here
            </h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              The platform combines promotion tools with verification signals so customers can act
              with more confidence.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {pillars.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="border-border/70 bg-card/90">
                <CardHeader className="space-y-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-green-100 text-brand-green-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base sm:text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="container-page py-4 space-y-6 sm:py-6">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
              Choose your visibility surface
            </h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              Start with the format that matches your offer, then expand into other surfaces as your
              campaigns grow.
            </p>
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
                  <Button asChild variant="outline" className="w-full sm:w-auto">
                    <Link href={surface.href}>Open {surface.name}</Link>
                  </Button>
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
