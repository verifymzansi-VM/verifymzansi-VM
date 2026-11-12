import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, MessageCircle, Phone, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SamplePostChip } from "@/components/sample-posts/sample-post-chip";
import { findSamplePost } from "@/lib/sample-posts/load";
import { contactPhone, whatsappLink } from "@/lib/utils/contact-links";

// The switch is read on every request, so turning samples off takes effect at once.
export const dynamic = "force-dynamic";

interface SamplePostPageProps {
  params: Promise<{ slug: string }>;
}

const NOINDEX = { index: false, follow: false } as const;

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
 * A display-only sample post: a local business's video shown, with its
 * permission, as an example of how posts look. It is not a member post, so it
 * has no trust badges, views, likes, reports or leads.
 */
export default async function SamplePostPage({ params }: SamplePostPageProps) {
  const { slug } = await params;
  const post = await findSamplePost(slug);
  if (!post) notFound();

  const path = `/sample/${post.slug}`;
  const phone = contactPhone(post.contact?.phone);
  const whatsapp = whatsappLink(post.contact?.whatsapp, post.title, path);

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
            <li className="flex items-center gap-2">
              <Store className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{post.businessName}</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {post.city}, {post.province}
              </span>
            </li>
          </ul>

          <p className="mt-4 rounded-xl border border-brand-gold-300/40 bg-brand-gold-50 px-3.5 py-2.5 text-sm leading-6 text-brand-gold-950 dark:bg-brand-gold-300/10 dark:text-brand-gold-100">
            An example post, shown with the business&apos;s permission. VerifyMzansi has not checked
            anything on it.
          </p>

          <p className="mt-5 whitespace-pre-line text-base leading-7 text-foreground">
            {post.description}
          </p>

          {phone || whatsapp ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {phone ? (
                <Button asChild size="lg" className="h-11">
                  <a href={`tel:${phone}`}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Call
                  </a>
                </Button>
              ) : null}
              {whatsapp ? (
                <Button asChild size="lg" variant="outline" className="h-11">
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    WhatsApp
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
