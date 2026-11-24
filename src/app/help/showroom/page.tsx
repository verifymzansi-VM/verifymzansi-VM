import type { Metadata } from "next";
import Link from "next/link";
import { Eye, Heart, MapPin, PlayCircle, Shuffle, Sparkles, UserX } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { InfoHero, SectionHeading } from "@/components/safety/info-hero";
import { Button } from "@/components/ui/button";
import { SHOW_OWNER_METRICS } from "@/lib/hidden-features";

export const metadata: Metadata = {
  title: "How the showroom works",
  description:
    "How VerifyMzansi decides which posts appear in the showroom and how views are counted.",
};

const ORDER_RULES = [
  {
    icon: Shuffle,
    name: "Everyone takes turns",
    description:
      "Free or paid, every live post gets an equal turn at the front of the showroom. The posts that have been seen least this week go next.",
  },
  {
    icon: Sparkles,
    name: "New posts get a head start and a New tag for 3 days",
    description:
      "For the first 3 days after a post first goes live, it carries a New tag and is moved forward, a little less each day. Editing or renewing a post does not make it new again.",
  },
  {
    icon: MapPin,
    name: "Near you first, never only near you",
    description:
      "Of every 7 places, 3 go to posts from your city, 2 to the rest of your province and 2 to the rest of South Africa, so a post in a small town still reaches the big cities. We estimate your area from your internet connection for that page only and never store it. A post that has already had more than twice its fair share this week waits with the rest of South Africa.",
  },
  {
    icon: PlayCircle,
    name: "A small nudge for video",
    description:
      "The showroom is built for video, so a post with a video gets a small boost within its turn. It never jumps the queue.",
  },
  {
    icon: Heart,
    name: "Likes help a little",
    description:
      "A post that more of its visitors like gets a small nudge within its turn. We count likes per view, so a new post is not behind a popular one, and likes never jump the queue.",
  },
];

const COUNTING_RULES = [
  {
    icon: PlayCircle,
    name: "A video view",
    description:
      "The video played for 2 seconds in a row with at least half of it on screen. This follows the common industry standard for counting a video ad view.",
  },
  {
    icon: Eye,
    name: "A page view",
    description:
      "Someone opened your post's own page. Opening the page and watching its video within 30 minutes counts once.",
  },
  {
    icon: UserX,
    name: "What does not count",
    description:
      "Your own views, VerifyMzansi staff, search engine robots, and the same person again within 30 minutes. Very high numbers from one network are capped, so nobody can inflate a count.",
  },
];

export default function ShowroomHelpPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main id="main-content" className="flex-1">
        <InfoHero
          title="How the showroom works"
          description="Fair turns for every post, and views counted honestly."
          breadcrumbs={[{ label: "Help" }, { label: "Showroom" }]}
          actions={
            // Hidden until it works (src/lib/hidden-features.ts).
            SHOW_OWNER_METRICS ? (
              <Button asChild variant="trust-verified" size="lg">
                <Link href="/dashboard/metrics">See your post&apos;s turns</Link>
              </Button>
            ) : undefined
          }
        />

        <div className="container-page max-w-4xl space-y-14 py-10 sm:py-14">
          <section aria-labelledby="order-title">
            <SectionHeading
              id="order-title"
              title="Who appears first"
              lede="The order is worked out again every minute, so it keeps moving."
            />
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {ORDER_RULES.map((rule) => (
                <li key={rule.name} className="surface-card flex gap-4 p-5">
                  <span className="icon-tile area-market-tile">
                    <rule.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="font-body text-base font-semibold text-foreground">
                      {rule.name}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {rule.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="counting-title">
            <SectionHeading
              id="counting-title"
              title="How views are counted"
              lede="Every page that shows your post counts: the showrooms, home page rows, lists, your post's page and the full-screen viewer."
            />
            <ul className="mt-6 grid gap-3 md:grid-cols-3">
              {COUNTING_RULES.map((rule) => (
                <li key={rule.name} className="surface-card p-5">
                  <span className="icon-tile bg-muted text-foreground/80">
                    <rule.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-3 font-body text-base font-semibold text-foreground">
                    {rule.name}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{rule.description}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Your dashboard also shows <strong>engaged views</strong>: people who watched for 30
              seconds, or 90% of a shorter video. A showroom appearance counts when your post sat at
              the front of the showroom for a full second while the showroom was on screen.
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
