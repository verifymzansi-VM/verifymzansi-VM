import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin, Users } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero } from "@/components/safety/info-hero";
import { brandOutlineButtonClassName } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { SponsorLink } from "@/components/organisations/sponsor-link";
import { SponsorLogo } from "@/components/organisations/sponsor-logo";
import {
  getPublicSponsors,
  organisationTypeLabel,
  sponsorArea,
} from "@/lib/organisations/sponsors";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Programme partners",
  description:
    "Organisations that support local businesses on VerifyMzansi. Browse the businesses in each programme.",
  alternates: { canonical: "/sponsors" },
};

export const revalidate = 300;

export default async function SponsorsPage() {
  const sponsors = await getPublicSponsors();

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 scroll-mt-24">
        <InfoHero
          title="Programme partners"
          accent="backing local business."
          description="Chambers, municipalities, enterprise-development programmes and companies that support local businesses on VerifyMzansi."
          breadcrumbs={[{ label: "Programme partners" }]}
          actions={
            <>
              <Button asChild variant="trust-verified" size="lg" className="h-12 rounded-full">
                <Link href="/mzansi-business">Browse Mzansi Business</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className={cn("h-12 rounded-full", brandOutlineButtonClassName)}
              >
                <Link href="/advertise#programmes">Become a programme partner</Link>
              </Button>
            </>
          }
        />

        <section aria-labelledby="sponsors-what" className="container-page py-10 sm:py-12">
          <h2 id="sponsors-what" className="section-title">
            What a programme partner is
          </h2>
          <p className="section-lede max-w-3xl">
            A programme partner funds or runs a programme that helps local businesses get online.
            Businesses join only with their consent and show &ldquo;Supported by&rdquo; the partner.
            That label means programme membership. It is not a verification, safety or quality
            endorsement: VerifyMzansi reviews every poster&rsquo;s identity separately.
          </p>

          {sponsors.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed p-8 text-center">
              <p className="font-display text-lg font-semibold">
                Our first programme partners are joining
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Founding programmes open in the City of uMhlathuze. Their businesses appear here as
                they go live.
              </p>
            </div>
          ) : (
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sponsors.map((sponsor) => {
                const area = sponsorArea(sponsor);
                return (
                  <li key={sponsor.id}>
                    <SponsorLink
                      href={`/organisation/${sponsor.slug}`}
                      organisationId={sponsor.id}
                      surface="sponsors_index"
                      className="flex h-full flex-col rounded-2xl border border-border/70 bg-card p-5 elev-xs transition-shadow hover:elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-3">
                        <SponsorLogo src={sponsor.logo_url} name={sponsor.name} size={52} />
                        <span className="min-w-0">
                          <span className="block font-display text-lg font-bold leading-tight text-foreground">
                            {sponsor.name}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {organisationTypeLabel(sponsor.organisation_type)}
                          </span>
                        </span>
                      </span>
                      <span className="mt-4 flex flex-1 flex-wrap content-start items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                        {area ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin aria-hidden="true" className="h-4 w-4" />
                            {area}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <Users aria-hidden="true" className="h-4 w-4" />
                          {sponsor.live_businesses > 0
                            ? `${sponsor.live_businesses} supported ${sponsor.live_businesses === 1 ? "business" : "businesses"}`
                            : "Onboarding businesses"}
                        </span>
                        {sponsor.programme_status === "founding_trial" ? (
                          <Badge variant="secondary">Founding pilot</Badge>
                        ) : null}
                      </span>
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-green-700 dark:text-brand-green-300">
                        View businesses
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </span>
                    </SponsorLink>
                  </li>
                );
              })}
            </ul>
          )}
          <AnalyticsImpressions
            items={sponsors.map((sponsor) => ({ table: "organisations", id: sponsor.id }))}
            surface="sponsors_index"
          />
        </section>

        <section aria-labelledby="sponsors-cta" className="container-page pb-14 sm:pb-20">
          <div className="flex flex-col gap-5 rounded-3xl bg-muted/70 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2
                id="sponsors-cta"
                className="font-display text-2xl font-bold tracking-tight text-foreground"
              >
                Want to support local businesses?
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
                Give 25 to 250 businesses a free profile (each owner still passes our ID review), a
                branded showcase and an activity summary every 30 days.
              </p>
            </div>
            <Button asChild variant="ink" className="h-11 shrink-0 rounded-full px-5">
              <Link href="/advertise#programmes">Become a programme partner</Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
