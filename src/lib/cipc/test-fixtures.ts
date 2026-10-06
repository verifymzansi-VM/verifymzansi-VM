/**
 * Synthetic CIPC page layouts for tests. Coordinates mirror real Crystal
 * Reports output (Disclosure Certificate and CoR14.3); every value is fake.
 */
import type { PdfTextItem } from "./parse";

export const FAKE_DIRECTOR_ID = "8001015009087";
export const FAKE_SECOND_ID = "9202204800081";

type Options = {
  kind?: "official_disclosure" | "registration_certificate" | "free_disclosure" | "other";
  number?: string;
  name?: string;
  status?: string;
  issued?: string;
  directors?: Array<{ name: string; role?: string; id: string }>;
  office?: string[];
};

export function cipcItems(options: Options = {}): PdfTextItem[] {
  const kind = options.kind ?? "official_disclosure";
  const number = options.number ?? "2020 / 123456 / 07";
  const name = options.name ?? "EXAMPLE TRADING (PTY) LTD";
  const office = options.office ?? [
    "12 MAIN ROAD",
    "KWADLANGEZWA",
    "EMPANGENI",
    "KWA-ZULU NATAL",
    "3886",
  ];
  const directors = options.directors ?? [
    { name: "DLAMINI, THANDO", role: "Director", id: FAKE_DIRECTOR_ID },
  ];
  const title =
    kind === "registration_certificate"
      ? "COR14.3: Registration Certificate"
      : kind === "other"
        ? "Tax Clearance Certificate"
        : "Disclosure Certificate: Companies and Close Corporations";

  const items: PdfTextItem[] = [
    { x: 30, y: 797, text: "Certificate issued by the Commissioner of Companies & Intellectual" },
    {
      x: 30,
      y: 782,
      text: `Property Commission on ${options.issued ?? "Monday, October 5, 2026 at 12:54"}`,
    },
    { x: 30, y: 753, text: title },
    { x: 31, y: 735, text: "Registration Number:" },
    { x: 103, y: 735, text: number },
    { x: 31, y: 723, text: "Enterprise Name:" },
    { x: 103, y: 723, text: name },
    { x: 36, y: 688, text: "ENTERPRISE INFORMATION" },
    { x: 36, y: 673, text: "Registration Number" },
    { x: 186, y: 673, text: number },
    { x: 36, y: 655, text: "Enterprise Name" },
    { x: 186, y: 655, text: name },
    { x: 36, y: 637, text: "Registration Date" },
    { x: 186, y: 637, text: "14/03/2020" },
    { x: 36, y: 601, text: "Enterprise Type" },
    { x: 186, y: 601, text: "Private Company" },
    { x: 36, y: 583, text: "Enterprise Status" },
    { x: 186, y: 583, text: options.status ?? "In Business" },
    { x: 36, y: 510, text: "Addresses" },
    { x: 186, y: 509, text: "POSTAL ADDRESS" },
    { x: 372, y: 509, text: "ADDRESS OF REGISTERED OFFICE" },
    ...office.map((text, i) => ({ x: 372, y: 492 - i * 12, text })),
    { x: 30, y: 421, text: "ACTIVE MEMBERS / DIRECTORS" },
    { x: 30, y: 403, text: "Surname and First Names" },
    { x: 204, y: 403, text: "Type" },
    { x: 264, y: 403, text: "ID Number /" },
    { x: 264, y: 391, text: "Date of Birth" },
    { x: 413, y: 403, text: "Appoint." },
  ];
  directors.forEach((d, i) => {
    const y = 375 - i * 50;
    items.push(
      { x: 33, y, text: d.name },
      { x: 207, y, text: d.role ?? "Director" },
      { x: 267, y, text: d.id },
      { x: 411, y, text: "14/03/2020" },
      { x: 455, y, text: "Postal: 12 MAIN ROAD," }
    );
  });
  if (kind === "official_disclosure") {
    items.push(
      { x: 30, y: 298, text: "AUDITOR DETAILS" },
      { x: 30, y: 202, text: "CHANGE SUMMARY" },
      { x: 36, y: 564, text: "Compliance Notice Status" },
      { x: 186, y: 564, text: "NONE" }
    );
  }
  items.push({ x: 538, y: 92, text: "Page 1 of 1" });
  return items;
}
