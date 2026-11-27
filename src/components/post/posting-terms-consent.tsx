"use client";

/** Each area's colours for the tick and the "View terms" link. */
const ACCENTS = {
  green: {
    box: "accent-brand-green-600",
    link: "text-brand-green-700 dark:text-brand-gold-300",
  },
  blue: {
    box: "accent-brand-blue-600",
    link: "text-brand-blue-700 dark:text-brand-blue-300",
  },
  teal: {
    box: "accent-teal-600",
    link: "text-teal-700 dark:text-teal-300",
  },
} as const;

interface PostingTermsConsentProps {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
  /** What is being posted, in the sentence ("this business post"). */
  subject?: "post" | "business post" | "tourism or event post";
  accent?: keyof typeof ACCENTS;
}

/** The posting-terms tick on the create forms, and on the edit forms while the
 * member has not accepted the current terms yet. One wording for every form. */
export function PostingTermsConsent({
  id,
  checked,
  onCheckedChange,
  error,
  subject = "post",
  accent = "green",
}: PostingTermsConsentProps) {
  const colours = ACCENTS[accent];
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 text-sm leading-6">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className={`mt-1 h-4 w-4 shrink-0 rounded ${colours.box}`}
        aria-invalid={!!error}
      />
      <span>
        I accept the VerifyMzansi posting terms, including the free-post visibility period and my
        responsibility for the accuracy and legality of this {subject}.{" "}
        <a className={`font-semibold ${colours.link} underline underline-offset-2`} href="/terms">
          View terms
        </a>
        .{error && <span className="mt-1 block text-destructive">{error}</span>}
      </span>
    </label>
  );
}
