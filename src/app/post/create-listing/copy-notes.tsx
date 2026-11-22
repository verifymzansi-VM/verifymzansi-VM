import { Copy, Video } from "lucide-react";

/** Above the steps when the form is open on a copy (business tools plan, bt-07). */
export function CopyNotice({ title }: { title: string }) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-2xl border border-brand-gold-300/70 bg-brand-gold-50 p-4 text-sm leading-6 text-foreground dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10"
    >
      <Copy
        aria-hidden="true"
        className="mt-1 h-4 w-4 shrink-0 text-brand-gold-800 dark:text-brand-gold-300"
      />
      <p>
        <span className="font-semibold">Copy of &ldquo;{title}&rdquo;.</span> Everything except the
        video is filled in. Change what is different on each step. The copy waits in Drafts until
        you submit it; your other unfinished post is not touched.
      </p>
    </div>
  );
}

/** Above the video picker: the video is never copied. */
export function CopyVideoNote() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
      <Video aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      Video not copied. Add this item&apos;s own video below if you have one.
    </p>
  );
}

/** Final check of a copy: a gentle hint for an unchanged title, and fair use. */
export function CopyFinalCheck({ sameTitle }: { sameTitle: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      {sameTitle ? (
        <p className="text-brand-gold-900 dark:text-brand-gold-200">
          <span className="font-semibold">Same title as the post you copied.</span> Add what is
          different, like the colour or year, so buyers can tell them apart.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Copies are checked like any new post and count towards your new posts allowance.
      </p>
    </div>
  );
}
