"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { MarketplaceArea } from "@/types/enums";

/** The new post's id from a create answer (read from a copy, so the caller
 * can still read the body); null when it is not there. */
export async function createdPostId(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as { id?: unknown } | null;
    return typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  } catch {
    return null;
  }
}

/**
 * The clear screen every create form shows after a successful submit, in place
 * of a short pop-up: what happens next, and a link to the post, shown "In review".
 */
export function PostSubmittedScreen({
  postTitle,
  area,
  postId = null,
}: {
  postTitle: string;
  area: MarketplaceArea;
  /** The new post: the link opens My posts at its card, shown "In review". */
  postId?: string | null;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, []);
  const myPostsHref = `/dashboard/listings?area=${area}`;
  const postHref = postId ? `${myPostsHref}#post-${postId}` : myPostsHref;
  return (
    <section
      aria-labelledby="post-submitted-title"
      className="surface-card mx-auto max-w-xl space-y-5 p-6 text-center sm:p-8"
      data-post-submitted
    >
      <CheckCircle2
        aria-hidden="true"
        className="mx-auto h-12 w-12 text-brand-green-600 dark:text-brand-gold-300"
      />
      <div className="space-y-2">
        <h1
          id="post-submitted-title"
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-2xl font-bold text-foreground focus:outline-none"
        >
          Submitted
        </h1>
        <p className="text-base text-muted-foreground">
          Our team reviews every post before it goes live.
        </p>
      </div>
      <Link
        href={postHref}
        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:bg-muted/50"
      >
        <span className="min-w-0 truncate font-semibold text-foreground">{postTitle}</span>
        <span className="shrink-0 rounded-full bg-brand-gold-100 px-2.5 py-0.5 text-xs font-semibold text-brand-gold-900 dark:bg-brand-gold-900/40 dark:text-brand-gold-100">
          In review
        </span>
      </Link>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          href={myPostsHref}
          className="inline-flex h-11 items-center justify-center rounded-full bg-brand-green-700 px-6 text-sm font-semibold text-white hover:bg-brand-green-800"
        >
          Go to My posts
        </Link>
        <Link
          href="/post/create"
          className="inline-flex h-11 items-center justify-center rounded-full border border-border px-6 text-sm font-semibold hover:bg-muted"
        >
          Create another post
        </Link>
      </div>
    </section>
  );
}
