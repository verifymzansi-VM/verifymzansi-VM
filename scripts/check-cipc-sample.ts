/**
 * Checks CIPC PDF structure against a reference profile without printing
 * filenames, field values or editable metadata. These indicators cannot prove
 * authenticity; compare the document with an independent CIPC record.
 *
 *   CIPC_SAMPLE_PDF="C:/path/one.pdf;C:/path/two.pdf" npx tsx scripts/check-cipc-sample.ts
 *
 * Never commit a real CIPC document: it carries ID numbers and addresses.
 */
import { readFileSync } from "node:fs";

import { extractPdf } from "../src/lib/cipc/pdf";
import { parseCipcText } from "../src/lib/cipc/parse";
import { fingerprintTraits } from "../src/lib/cipc/screen";

async function check(path: string, index: number): Promise<void> {
  const extracted = await extractPdf(new Uint8Array(readFileSync(path)));
  const name = `Sample ${index + 1}`;
  if (!extracted) {
    console.log(`${name}: could not be opened as a PDF`);
    return;
  }
  const parsed = extracted.structure.hasTextLayer ? parseCipcText(extracted.items) : null;
  const traits = fingerprintTraits(extracted.structure, parsed?.docType ?? null);
  const verdict = traits.some((t) => t.strong)
    ? "possible editing indicators"
    : traits.length
      ? "differs (weak signs only)"
      : "no recognized edit indicators";
  console.log(`${name}: ${verdict}`);
  console.log(
    `  read: type=${parsed?.docType ?? "none"} number=${!!parsed?.registrationNumber} name=${!!parsed?.registeredName} office=${parsed?.registeredOfficeLines.length ?? 0} lines directors=${parsed?.directors.length ?? 0}`
  );
  console.log(
    `  indicators: strong=${traits.filter((trait) => trait.strong).length} weak=${traits.filter((trait) => !trait.strong).length}`
  );
}

async function main(): Promise<void> {
  const paths = (process.env.CIPC_SAMPLE_PDF ?? "").split(";").filter(Boolean);
  if (!paths.length) {
    console.log("Set CIPC_SAMPLE_PDF to one or more PDF paths (separated by ;).");
    return;
  }
  for (const [index, p] of paths.entries()) await check(p, index);
}

void main();
