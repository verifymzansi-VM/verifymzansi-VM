import parse from "spdx-expression-parse";
import { createHash } from "node:crypto";
type Package = { name: string; versions: string[]; license?: string };
export type RemotionLicenseEvidence = { review: unknown; licenseText: string };
const REMOTION_LICENSE_HASH = "vWUIO5QPYZBPbvKYqt6RinytcqPjW8QG42-rNlhEtnM";
const REMOTION_EXPRESSIONS: Record<string, string> = {
  remotion: "Unknown",
  "@remotion/bundler": "Unknown",
  "@remotion/cli": "Unknown",
  "@remotion/compositor-win32-x64-msvc": "Unknown",
  "@remotion/compositor-linux-x64-gnu": "Unknown",
  "@remotion/media": "Unknown",
  "@remotion/player": "Unknown",
  "@remotion/renderer": "Unknown",
  "@remotion/web-renderer": "Unknown",
  "@remotion/canvas": "Remotion License",
  "@remotion/studio-protocol": "Remotion License",
  "@remotion/media-parser": "Remotion License https://remotion.dev/license",
};
function reviewedRemotion(pkg: Package, expression: string, evidence?: RemotionLicenseEvidence) {
  if (
    !evidence ||
    !evidence.review ||
    typeof evidence.review !== "object" ||
    Array.isArray(evidence.review) ||
    typeof evidence.licenseText !== "string"
  )
    return false;
  const review = evidence.review as Record<string, unknown>;
  return (
    Object.hasOwn(REMOTION_EXPRESSIONS, pkg.name) &&
    REMOTION_EXPRESSIONS[pkg.name] === expression &&
    pkg.versions.every((version) => version === "4.0.529") &&
    review.schemaVersion === 1 &&
    review.packageVersion === "4.0.529" &&
    review.declaredBy === "project-owner" &&
    review.declaredAt === "2026-10-03" &&
    typeof review.companyEmployeeCount === "number" &&
    Number.isSafeInteger(review.companyEmployeeCount) &&
    review.companyEmployeeCount >= 0 &&
    review.companyEmployeeCount <= 3 &&
    review.useCase === "marketing-video-and-image-rendering" &&
    review.licenseSource === "https://www.remotion.dev/license" &&
    review.licenseSha256 === REMOTION_LICENSE_HASH &&
    createHash("sha256").update(evidence.licenseText.replace(/\r\n/g, "\n")).digest("base64url") ===
      REMOTION_LICENSE_HASH
  );
}
export function validateLicenseReport(
  report: unknown,
  ffmpegNotice = "",
  remotion?: RemotionLicenseEvidence
): string[] {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    Object.keys(report).length === 0
  )
    throw new Error("License report must be a nonempty license-to-packages object");
  const errors: string[] = [];
  for (const [expression, rows] of Object.entries(report)) {
    if (!Array.isArray(rows) || rows.length === 0)
      throw new Error(`Invalid package list for ${expression}`);
    for (const raw of rows) {
      if (
        !raw ||
        typeof raw !== "object" ||
        typeof raw.name !== "string" ||
        !raw.name.trim() ||
        !Array.isArray(raw.versions) ||
        !raw.versions.length ||
        raw.versions.some((v: unknown) => typeof v !== "string" || !v.trim())
      )
        throw new Error(`Invalid package record for ${expression}`);
      const pkg = raw as Package;
      if (pkg.license !== undefined && pkg.license !== expression)
        throw new Error(`License bucket disagrees with package ${pkg.name}`);
      if (reviewedRemotion(pkg, expression, remotion)) continue;
      // Retain the already reviewed standalone WASM exception, pinned to its evidence.
      if (
        pkg.name === "@ffmpeg/core" &&
        expression === "GPL-2.0-or-later" &&
        pkg.versions.every((v) => v === "0.12.9")
      ) {
        if (
          !ffmpegNotice.includes("@ffmpeg/core 0.12.9") ||
          !ffmpegNotice.includes("GPL-2.0-or-later") ||
          !ffmpegNotice.includes("https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.9")
        )
          errors.push("FFmpeg exception missing corresponding-source/notice evidence");
        continue;
      }
      if (/\bLicenseRef-/i.test(expression)) {
        errors.push(`${pkg.name}: custom license expression requires review ${expression}`);
        continue;
      }
      try {
        parse(expression);
        // Either side of an OR containing restricted terms still requires review.
        if (/AGPL|\bGPL-[23](?:\.0)?|BUSL-1\.1|FSL-/i.test(expression))
          errors.push(`${pkg.name}: restricted license ${expression}`);
      } catch {
        errors.push(`${pkg.name}: unknown or invalid license expression ${expression}`);
      }
    }
  }
  return errors;
}
