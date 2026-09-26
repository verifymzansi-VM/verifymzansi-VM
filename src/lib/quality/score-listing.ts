/**
 * Advisory listing quality score (0–100) with plain-language suggestions.
 * It never blocks or penalises a post on its own: moderators and owners use it
 * to improve listings. Checks are deterministic and cheap (no network).
 */
export interface QualityInput {
  title?: string | null;
  description?: string | null;
  priceCents?: number | null;
  /** Category-aware sanity bounds; omit when price is not applicable. */
  priceExpected?: boolean;
  category?: string | null;
  location?: string | null;
  photos?: ReadonlyArray<string | null | undefined> | null;
  /** Photos chosen but not uploaded yet (posting wizard). */
  pendingPhotoCount?: number;
  /** Other titles by the same owner in the last 30 days (for duplicate detection). */
  recentOwnerTitles?: ReadonlyArray<string>;
  /** Photo URLs already used by the owner's other live posts. */
  ownerPhotoUrls?: ReadonlyArray<string>;
}

export type QualitySeverity = "info" | "warning" | "review";

export interface QualityIssue {
  code: string;
  severity: QualitySeverity;
  message: string;
  penalty: number;
}

export interface QualityResult {
  score: number;
  issues: QualityIssue[];
}

const PLACEHOLDER =
  /\b(lorem ipsum|test(ing)? (post|listing)|asdf|qwerty|placeholder|sample text|xxx+)\b/i;
const CONTACT_IN_TEXT =
  /(\+?27|0)[\s-]?[6-8]\d[\s-]?\d{3}[\s-]?\d{4}|[\w.+-]+@[\w-]+\.[\w.]+|wa\.me\//i;
/** Terms §3–4: weapons, illegal substances, counterfeit goods, protected wildlife products. */
const PROHIBITED_TERMS =
  /\b(firearms?|handguns?|ammunition|ammo|unlicensed (gun|pistol|rifle)s?|cocaine|heroin|mandrax|crystal meth|counterfeit|fake (id|passport|licen[cs]e|documents?|certificates?)|rhino horns?|elephant ivory|ivory tusks?)\b/i;
const SUSPICIOUS_TERMS =
  /\b(western union|moneygram|gift ?cards?|crypto only|deposit first|pay (a )?deposit to (secure|reserve)|bitcoin only)\b/i;

export function normaliseTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreListingQuality(input: QualityInput): QualityResult {
  const issues: QualityIssue[] = [];
  const add = (code: string, severity: QualitySeverity, penalty: number, message: string) =>
    issues.push({ code, severity, penalty, message });

  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const photos = (input.photos ?? []).filter((url): url is string => Boolean(url));

  if (!title) add("missing_title", "review", 30, "Add a clear title.");
  else if (title.length < 10)
    add("short_title", "info", 8, "Use a more descriptive title (10+ characters).");

  if (!description)
    add("missing_description", "warning", 20, "Add a description buyers can trust.");
  else if (description.length < 60)
    add(
      "short_description",
      "info",
      10,
      "Describe condition, what's included and how to collect or book."
    );

  if (PLACEHOLDER.test(`${title} ${description}`))
    add("placeholder_content", "review", 25, "Replace placeholder or test text with real details.");

  if (input.priceExpected) {
    const price = input.priceCents;
    if (price === null || price === undefined || !Number.isFinite(price) || price < 0)
      add("invalid_price", "warning", 15, "Add a valid price or mark it negotiable.");
    else if (price > 0 && price < 1000)
      add("suspicious_price", "review", 10, "This price looks unusually low. Check it is correct.");
    else if (price > 5_000_000_000)
      add(
        "suspicious_price",
        "review",
        10,
        "This price looks unusually high. Check it is correct."
      );
  }

  if (!input.category)
    add("missing_category", "warning", 10, "Choose a category so people can find this.");
  if (!input.location) add("missing_location", "warning", 10, "Add a town or city.");

  const photoCount = photos.length + (input.pendingPhotoCount ?? 0);
  if (photoCount === 0) add("no_photos", "warning", 15, "Add at least one clear photo.");
  else if (photoCount < 3)
    add("few_photos", "info", 5, "Posts with 3 or more photos get more interest.");
  if (photos.some((url) => !/^https:\/\//i.test(url)))
    add(
      "broken_image",
      "warning",
      10,
      "One or more images could not be loaded. Upload them again."
    );
  if (new Set(photos).size < photos.length)
    add("duplicate_images", "info", 5, "The same photo is used more than once.");
  if (input.ownerPhotoUrls?.length && photos.some((url) => input.ownerPhotoUrls!.includes(url)))
    add("reused_images", "review", 10, "Photos are reused from another of your posts.");

  if (
    title &&
    input.recentOwnerTitles?.some((other) => normaliseTitle(other) === normaliseTitle(title))
  )
    add(
      "duplicate_listing",
      "review",
      20,
      "You already have a post with this title. Update it instead of reposting."
    );

  if (CONTACT_IN_TEXT.test(description))
    add(
      "contact_in_text",
      "info",
      5,
      "Keep contact details in the contact fields so buyers stay protected."
    );
  if (SUSPICIOUS_TERMS.test(`${title} ${description}`))
    add(
      "suspicious_terms",
      "review",
      20,
      "Payment wording that is common in scams was found. Moderators will review it."
    );

  if (PROHIBITED_TERMS.test(`${title} ${description}`))
    add(
      "prohibited_content",
      "review",
      30,
      "Wording linked to prohibited items (weapons, illegal substances, counterfeit or protected wildlife goods) was found. A moderator will check it against the Terms."
    );

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + issue.penalty, 0));
  return { score, issues };
}
