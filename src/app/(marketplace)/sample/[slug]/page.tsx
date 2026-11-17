import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, MapPin } from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { SamplePostChip } from "@/components/sample-posts/sample-post-chip";
import { SampleContactActions } from "@/components/sample-posts/sample-contact-actions";
import { SAMPLE_POST_PRESENTER, upcomingEventDate } from "@/lib/sample-posts/catalogue";
import { readSampleContact } from "@/lib/sample-posts/contact";
import { findSamplePost } from "@/lib/sample-posts/load";

// The switch and the staff hide-list are read on every request.
export const dynamic = "force-dynamic";

interface SamplePostPageProps {
  params: Promise<{ slug: string }>;
}

const NOINDEX = { index: false, follow: false } as const;

function formatEventDate(value: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export async function generateMetadata({ params }: SamplePostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await findSamplePost(slug);
  if (!post) return { title: "Not found", robots: NOINDEX };
  return {
    title: `${post.title} | Sample post`,
    description: post.description.slice(0, 160),
    robots: NOINDEX,
  };
}

/**
 * A display-only sample post: VerifyMzansi's own example of how posts look.
 * It is not a member post and names no business, so it has no trust badges,
 * views, likes, reports or enquiries; its contact buttons reach VerifyMzansi.
 */
export default async function SamplePostPage({ params }: SamplePostPageProps) {
  const { slug } = await params;
  const post = await findSamplePost(slug);
  if (!post) notFound();

  const eventDate = upcomingEventDate(post);
  const contact = readSampleContact();

  return (
    <article className="container-page py-6 sm:py-10" data-sample-post>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-10">
        <div className="mx-auto w-[min(100%,420px,calc(65svh*0.5625))] overflow-hidden rounded-[28px] bg-slate-950 shadow-lg ring-1 ring-black/5">
          <video
            className="aspect-[9/16] h-full w-full object-contain"
            src={post.videoUrl}
            poster={post.posterUrl}
            controls
            playsInline
            preload="metadata"
            aria-label={post.title}
          />
        </div>

        <div className="min-w-0">
          <SamplePostChip />
          <h1 className="mt-3 font-display text-2xl font-bold leading-tight tracking-[-0.02em] text-foreground sm:text-3xl">
            {post.title}
          </h1>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-center gap-2" data-sample-presenter>
              <BrandShield className="h-5 w-5 shrink-0" />
              <span className="font-medium text-foreground">{SAMPLE_POST_PRESENTER}</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              {/* A sample placed only by its province or region names it once. */}
              <span>
                {post.city.includes(post.province) ? post.city : `${post.city}, ${post.province}`}
              </span>
            </li>
            {eventDate ? (
              <li className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                <time dateTime={eventDate}>{formatEventDate(eventDate)}</time>
              </li>
            ) : null}
          </ul>

          <p className="mt-4 rounded-xl border border-brand-gold-300/40 bg-brand-gold-50 px-3.5 py-2.5 text-sm leading-6 text-brand-gold-950 dark:bg-brand-gold-300/10 dark:text-brand-gold-100">
            This is an example post to show how VerifyMzansi looks. VerifyMzansi has not checked the
            business in the video.
          </p>

          <p className="mt-5 whitespace-pre-line text-base leading-7 text-foreground">
            {post.description}
          </p>

          {contact ? <SampleContactActions slug={post.slug} title={post.title} /> : null}
        </div>
      </div>
    </article>
  );
}
