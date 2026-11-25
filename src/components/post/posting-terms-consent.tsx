"use client";

interface PostingTermsConsentProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
}

/** The posting-terms tick on Create listing, and on the edit forms while the
 * member has not accepted the current terms yet. */
export function PostingTermsConsent({
  id,
  checked,
  onCheckedChange,
  error,
}: PostingTermsConsentProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-6">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 rounded accent-brand-green-600"
        aria-invalid={!!error}
      />
      <span>
        I accept the VerifyMzansi posting terms, including the free-post visibility period and my
        responsibility for the accuracy and legality of this post.{" "}
        <a
          className="font-semibold text-brand-green-700 underline underline-offset-2 dark:text-brand-gold-300"
          href="/terms"
        >
          View terms
        </a>
        .{error && <span className="mt-1 block text-destructive">{error}</span>}
      </span>
    </label>
  );
}
