/**
 * Reads CIPC registry PDFs (Disclosure Certificate, CoR14.3 Registration
 * Certificate, free disclosure) from positioned text items.
 *
 * CIPC renders these with Crystal Reports: labels sit in a left column and
 * values on the same baseline to their right, the registered office is a
 * column under "ADDRESS OF REGISTERED OFFICE", and directors are rows under
 * "ACTIVE MEMBERS / DIRECTORS". Coordinates are PDF points, y grows upwards.
 *
 * The result is evidence for staff, never a decision. Raw director ID numbers
 * are returned so the caller can hash them; they must not be stored.
 */

export type PdfTextItem = { x: number; y: number; text: string };

export type CipcDocType =
  "official_disclosure" | "registration_certificate" | "free_disclosure" | "unknown";

export type ParsedDirector = {
  name: string;
  role: string | null;
  /** 13-digit SA ID number. Hash it; never persist it. */
  idNumber: string | null;
  /** Shown instead of an ID number for directors without an SA ID. */
  dateOfBirth: string | null;
  appointedOn: string | null;
};

export type ParsedCipcDocument = {
  docType: CipcDocType;
  /** ISO date (yyyy-mm-dd) from "Certificate issued … on <date>". */
  issuedOn: string | null;
  registrationNumber: string | null;
  registeredName: string | null;
  enterpriseType: string | null;
  enterpriseStatus: string | null;
  registrationDate: string | null;
  registeredOfficeLines: string[];
  directors: ParsedDirector[];
};

const SAME_LINE = 3;

const REG_NUMBER = /^(\d{4})\s*\/\s*(\d{6})\s*\/\s*(\d{2})$/;

/** "2026 / 155305 / 07" or "2026-155305-07" → "2026/155305/07". */
export function normaliseRegistrationNumber(value: string): string | null {
  const match = value.trim().replace(/-/g, "/").match(REG_NUMBER);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "dd/mm/yyyy" → "yyyy-mm-dd". */
function isoFromSlashDate(value: string): string | null {
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function issuedOnFrom(text: string): string | null {
  const m = text.match(/on\s+[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  return month < 0 ? null : `${m[3]}-${pad(month + 1)}-${pad(Number(m[2]))}`;
}

function clean(items: PdfTextItem[]): PdfTextItem[] {
  return items
    .map((i) => ({ x: i.x, y: i.y, text: i.text.replace(/\s+/g, " ").trim() }))
    .filter((i) => i.text.length > 0);
}

function find(items: PdfTextItem[], test: (text: string) => boolean): PdfTextItem | undefined {
  return items.find((i) => test(i.text));
}

/** Value printed on the same baseline to the right of a left-column label. */
function valueRightOf(items: PdfTextItem[], label: string, maxX = 360): string | null {
  const anchor = items.find((i) => i.text.toLowerCase() === label.toLowerCase() && i.x < 100);
  if (!anchor) return null;
  const value = items
    .filter((i) => Math.abs(i.y - anchor.y) <= SAME_LINE && i.x > anchor.x + 60 && i.x < maxX)
    .sort((a, b) => a.x - b.x)[0];
  return value?.text ?? null;
}

function detectDocType(items: PdfTextItem[]): CipcDocType {
  const has = (re: RegExp) => items.some((i) => re.test(i.text));
  if (has(/^COR\s*14\.3\b/i)) return "registration_certificate";
  if (has(/^Disclosure Certificate\b/i)) {
    return has(/^CHANGE SUMMARY$/i) ? "official_disclosure" : "free_disclosure";
  }
  return "unknown";
}

function registeredOffice(items: PdfTextItem[]): string[] {
  const header = find(items, (t) => /^ADDRESS OF REGISTERED OFFICE$/i.test(t));
  if (!header) return [];
  const directorsHeader = find(items, (t) => /^ACTIVE MEMBERS\s*\/\s*DIRECTORS$/i.test(t));
  const floor = directorsHeader ? directorsHeader.y : header.y - 120;
  return items
    .filter((i) => Math.abs(i.x - header.x) <= 10 && i.y < header.y - 2 && i.y > floor)
    .sort((a, b) => b.y - a.y)
    .map((i) => i.text);
}

const DIRECTOR_NAME = /^[A-Z][A-Z'’ .-]*,\s*[A-Z][A-Z'’ .-]*$/;

function directors(items: PdfTextItem[]): ParsedDirector[] {
  const section = find(items, (t) => /^ACTIVE MEMBERS\s*\/\s*DIRECTORS$/i.test(t));
  if (!section) return [];
  const columnHeader = items.find(
    (i) => /^Surname and First Names$/i.test(i.text) && i.y < section.y
  );
  const typeHeader = items.find(
    (i) => /^Type$/i.test(i.text) && columnHeader && Math.abs(i.y - columnHeader.y) <= SAME_LINE
  );
  const idHeader = items.find(
    (i) => /^ID Number/i.test(i.text) && columnHeader && Math.abs(i.y - columnHeader.y) <= SAME_LINE
  );
  if (!columnHeader || !typeHeader || !idHeader) return [];

  const nextSection = items
    .filter(
      (i) =>
        i.y < columnHeader.y && /^(AUDITOR DETAILS|CHANGE SUMMARY|Page \d+ of \d+)$/i.test(i.text)
    )
    .sort((a, b) => b.y - a.y)[0];
  const floor = nextSection ? nextSection.y : 0;
  const rows = items.filter(
    (i) =>
      i.y < columnHeader.y - 14 &&
      i.y > floor &&
      i.x < typeHeader.x - 10 &&
      DIRECTOR_NAME.test(i.text)
  );

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const near = (x: number, width: number) =>
        items.filter((i) => Math.abs(i.y - row.y) <= SAME_LINE && i.x >= x - 8 && i.x < x + width);
      const role = near(typeHeader.x, 50)[0]?.text ?? null;
      // The ID column can sit a line above or below the name baseline.
      const idCell = items
        .filter(
          (i) => Math.abs(i.y - row.y) <= 12 && i.x >= idHeader.x - 8 && i.x < idHeader.x + 70
        )
        .map((i) => i.text)
        .find((t) => /^\d{13}$/.test(t) || /^\d{2}\/\d{2}\/\d{4}$/.test(t));
      const appointed = items
        .filter((i) => Math.abs(i.y - row.y) <= SAME_LINE && i.x > idHeader.x + 70)
        .map((i) => i.text)
        .find((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t));
      return {
        name: row.text,
        role,
        idNumber: idCell && /^\d{13}$/.test(idCell) ? idCell : null,
        dateOfBirth: idCell && !/^\d{13}$/.test(idCell) ? isoFromSlashDate(idCell) : null,
        appointedOn: appointed ? isoFromSlashDate(appointed) : null,
      };
    });
}

export function parseCipcText(rawItems: PdfTextItem[]): ParsedCipcDocument {
  const items = clean(rawItems);
  const headline = items
    .filter((i) => i.y > (find(items, (t) => /^Registration Number:$/i.test(t))?.y ?? 0))
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((i) => i.text)
    .join(" ");
  const regRaw =
    valueRightOf(items, "Registration Number") ?? valueRightOf(items, "Registration Number:");
  const regDate = valueRightOf(items, "Registration Date");
  return {
    docType: detectDocType(items),
    issuedOn: issuedOnFrom(headline),
    registrationNumber: regRaw ? normaliseRegistrationNumber(regRaw) : null,
    registeredName:
      valueRightOf(items, "Enterprise Name") ?? valueRightOf(items, "Enterprise Name:"),
    enterpriseType: valueRightOf(items, "Enterprise Type"),
    enterpriseStatus: valueRightOf(items, "Enterprise Status"),
    registrationDate: regDate ? isoFromSlashDate(regDate) : null,
    registeredOfficeLines: registeredOffice(items),
    directors: directors(items),
  };
}
