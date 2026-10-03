import parse from "spdx-expression-parse";
type Package = { name: string; versions: string[]; license?: string };
export function validateLicenseReport(report: unknown, ffmpegNotice = ""): string[] {
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
