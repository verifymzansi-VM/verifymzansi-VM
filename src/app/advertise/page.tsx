import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BadgeCheck, Megaphone, ShieldCheck, Sparkles } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Advertise on VerifyMzansi",
  description:
    "Promote your event, deal, launch, or campaign to verified South African buyers on VerifyMzansi.",
};

const advertisingBenefits = [
  {
    title: "Reach verified buyers",
    description:
      "Promotions appear alongside trusted businesses, listings, and events across the marketplace.",
    icon: ShieldCheck,
  },
  {
    title: "Launch quickly",
    description:
      "Create a promotion with pricing, dates, media, and contact options in one guided flow.",
    icon: Megaphone,
  },
  {
    title: "Stand out with upgrades",
    description:
      "Use boosts and featured placement to push important campaigns higher in discovery surfaces.",
    icon: Sparkles,
  },
] as const;

const advertisingSteps = [
  "Create or sign in to your account.",
  "Complete verification so buyers can trust who is advertising.",
  "Publish your promotion with dates, media, price, and contact details.",
] as const;

export default function AdvertisePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-4 space-y-6">
          <PageHeader
            title="Advertise on VerifyMzansi"
            description="Run a trusted campaign for your event, launch, special offer, or business update."
            breadcrumbs={[{ label: "Advertise" }]}
          />

          <section className="relative overflow-hidden rounded-3xl border border-brand-green/15 bg-hero-mesh px-6 py-8 sm:px-8 sm:py-10">
            <div className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-brand-gold/10 to-transparent" />
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-green shadow-sm dark:bg-warm-900/80">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Promotions & Events
                </div>
                <div className="space-y-3">
                  <h1 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">
                    Put your next campaign in front of South Africans who expect trust first.
                  </h1>
                  <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                    Advertise launches, discounts, pop-ups, services, or community events with a
                    verified account and clear contact options.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button asChild size="lg" className="gap-2 rounded-full px-8">
                    <Link href="/post/create-promotion">
                      Start advertising
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="rounded-full px-8">
                    <Link href="/pricing">See pricing and plans</Link>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  You&apos;ll be prompted to sign in and complete verification before your promotion
                  goes live.
                </p>
              </div>

              <Card className="border-white/60 bg-white/85 shadow-xl backdrop-blur dark:border-white/10 dark:bg-warm-950/85">
                <CardHeader>
                  <CardTitle className="text-lg">How advertising works</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-3">
                    {advertisingSteps.map((step, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-sm font-semibold text-brand-green">
                          {index + 1}
                        </span>
                        <p className="pt-1 text-sm text-muted-foreground">{step}</p>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {advertisingBenefits.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="h-full">
                <CardHeader className="space-y-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-green/10 text-brand-green">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
