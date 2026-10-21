import rule from "./person-name-ranges.json";

/** Same table as internal.person_name_valid (generated together by
 * scripts/generate-person-name-rule.mjs), so app and database never disagree
 * because of a runtime's own Unicode version. */
const ranges = rule.ranges as [number, number][];
const PUNCTUATION = new Set([0x20, 0x27, 0x2e, 0x2d]);

function letterOrMark(code: number) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return true;
  }
  return false;
}

/** Display and legal name parts: NFC, 2-50 characters, letters and marks with
 * single spaces, apostrophes, full stops and hyphens. */
export function isPersonName(value: unknown): value is string {
  if (typeof value !== "string" || value.normalize("NFC") !== value) return false;
  const characters = Array.from(value);
  if (characters.length < 2 || characters.length > 50) return false;
  if (/^ | $| {2}/.test(value)) return false;
  return characters.every((character) => {
    const code = character.codePointAt(0) as number;
    return PUNCTUATION.has(code) || letterOrMark(code);
  });
}

/** Browser input: trim ordinary whitespace and compose to NFC before the
 * strict check. Inner tabs, newlines and other spaces are still refused. */
export function normalizePersonName(value: string) {
  return value.trim().normalize("NFC");
}

const RESERVED =
  /verify *mzansi|(^|[^a-z0-9_])(admin|administrator|moderator|support|staff|official)([^a-z0-9_]|$)/;

/** Names a person could mistake for the platform or its staff. ASCII-only case
 * folding matches internal.person_name_reserved exactly; the database applies
 * it whenever a display name changes. */
export function isReservedPersonName(value: string) {
  return RESERVED.test(value.replace(/[A-Z]/g, (letter) => letter.toLowerCase()));
}
