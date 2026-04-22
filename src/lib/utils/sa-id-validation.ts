/**
 * SA ID Number Validation Utilities.
 * Provides extraction and validation for South African 13-digit ID numbers.
 *
 * Format: YYMMDD GSSS C A Z
 *   - YYMMDD: Date of birth
 *   - GSSS:   Gender (0000–4999 = female, 5000–9999 = male)
 *   - C:      Citizenship (0 = SA citizen, 1 = permanent resident)
 *   - A:      Usually 8 (was used for race, now deprecated)
 *   - Z:      Luhn checksum digit
 */

import { SA_ID_LENGTH } from "@/lib/constants/verification";

/**
 * Extract date of birth from a South African ID number.
 * Handles century disambiguation dynamically based on the current year.
 */
export function extractDobFromSaId(idNumber: string): Date | null {
  if (!idNumber || idNumber.length < 6 || !/^\d{6}/.test(idNumber)) {
    return null;
  }

  const yy = parseInt(idNumber.substring(0, 2), 10);
  const mm = parseInt(idNumber.substring(2, 4), 10);
  const dd = parseInt(idNumber.substring(4, 6), 10);

  // Century disambiguation — dynamic cutoff based on current year.
  // Anyone with a 2-digit year that would make them younger than 0 is from the 1900s.
  // This ensures the cutoff advances naturally each year.
  const currentYearTwoDigit = new Date().getFullYear() % 100;
  const century = yy <= currentYearTwoDigit ? 2000 : 1900;
  const year = century + yy;

  // A person cannot be born in the future
  if (year > new Date().getFullYear()) {
    return null;
  }

  // Validate month/day ranges
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, mm - 1, dd));

  // Validate date actually exists (e.g., Feb 30 would roll over)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null;
  }

  return date;
}

/**
 * Calculate age in whole years from a date of birth.
 * Uses UTC to avoid timezone shifts.
 */
export function calculateAgeFromDob(dob: Date): number {
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Check if a South African ID number belongs to someone under 18.
 * Returns true if under 18, false if 18+, null if DOB cannot be extracted.
 */
export function isUnder18FromSaId(idNumber: string): boolean | null {
  const dob = extractDobFromSaId(idNumber);
  if (!dob) return null;
  return calculateAgeFromDob(dob) < 18;
}

/**
 * Extract gender from a South African ID number.
 * Digits 7-10 (0-indexed 6-9): 0000–4999 = female, 5000–9999 = male.
 */
export function extractGenderFromSaId(idNumber: string): "male" | "female" | null {
  if (!idNumber || idNumber.length < 10 || !/^\d{10}/.test(idNumber)) {
    return null;
  }

  const genderDigits = parseInt(idNumber.substring(6, 10), 10);
  return genderDigits >= 5000 ? "male" : "female";
}

/**
 * Extract citizenship status from a South African ID number.
 * Digit 11 (0-indexed 10): 0 = SA citizen, 1 = permanent resident.
 */
export function extractCitizenshipFromSaId(
  idNumber: string
): "citizen" | "permanent_resident" | null {
  if (!idNumber || idNumber.length < 11 || !/^\d{11}/.test(idNumber)) {
    return null;
  }

  const citizenDigit = parseInt(idNumber[10], 10);
  return citizenDigit === 0 ? "citizen" : "permanent_resident";
}

/**
 * Validate the Luhn checksum of a South African ID number.
 */
export function validateSaIdChecksum(idNumber: string): boolean {
  if (!idNumber || idNumber.length !== SA_ID_LENGTH || !/^\d{13}$/.test(idNumber)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < SA_ID_LENGTH; i++) {
    let digit = parseInt(idNumber[i], 10);

    // Double every second digit (0-indexed odd positions)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
  }

  return sum % 10 === 0;
}

/**
 * Format DOB extracted from SA ID into a human-readable string.
 */
export function formatSaIdDob(idNumber: string): string | null {
  const dob = extractDobFromSaId(idNumber);
  if (!dob) return null;

  return dob.toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Compare an ID number's embedded data against OCR payload from a provider.
 * Returns match status and any mismatches found.
 */
function _matchIdAgainstOcr(
  idNumber: string,
  ocrPayload: Record<string, unknown>
): { matches: boolean; mismatches: string[] } {
  const mismatches: string[] = [];

  // Extract DOB from ID number
  const idDob = extractDobFromSaId(idNumber);

  // Check DOB match if OCR provides it
  if (ocrPayload.date_of_birth && idDob) {
    const ocrDobStr = String(ocrPayload.date_of_birth);
    const ocrDob = new Date(ocrDobStr);

    if (
      !isNaN(ocrDob.getTime()) &&
      (ocrDob.getUTCFullYear() !== idDob.getUTCFullYear() ||
        ocrDob.getUTCMonth() !== idDob.getUTCMonth() ||
        ocrDob.getUTCDate() !== idDob.getUTCDate())
    ) {
      mismatches.push(
        `DOB mismatch: ID says ${idDob.toISOString().slice(0, 10)}, OCR says ${ocrDob.toISOString().slice(0, 10)}`
      );
    }
  }

  // Check ID number match if OCR extracts it
  if (ocrPayload.id_number) {
    const ocrId = String(ocrPayload.id_number).replace(/\s/g, "");
    if (ocrId !== idNumber) {
      mismatches.push(`ID number mismatch: submitted ${idNumber}, OCR read ${ocrId}`);
    }
  }

  // Check gender match if OCR provides it
  if (ocrPayload.gender) {
    const idGender = extractGenderFromSaId(idNumber);
    const ocrGender = String(ocrPayload.gender).toLowerCase();
    if (idGender && ocrGender && !ocrGender.startsWith(idGender.substring(0, 1))) {
      mismatches.push(`Gender mismatch: ID says ${idGender}, OCR says ${ocrGender}`);
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Full validation of a South African ID number.
 * Returns an object with all extracted info and validation results.
 */
export function validateSaIdFull(idNumber: string): {
  valid: boolean;
  checksum: boolean;
  dob: Date | null;
  gender: "male" | "female" | null;
  citizenship: "citizen" | "permanent_resident" | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (!idNumber || idNumber.length !== SA_ID_LENGTH) {
    errors.push(`ID number must be exactly ${SA_ID_LENGTH} digits`);
  }

  if (!/^\d+$/.test(idNumber || "")) {
    errors.push("ID number must contain only digits");
  }

  const checksum = validateSaIdChecksum(idNumber);
  if (!checksum && errors.length === 0) {
    errors.push("ID number failed Luhn checksum validation");
  }

  const dob = extractDobFromSaId(idNumber);
  if (!dob && errors.length === 0) {
    errors.push("Invalid date of birth encoded in ID number");
  }

  // Check DOB is not in the future
  if (dob && dob > new Date()) {
    errors.push("Date of birth cannot be in the future");
  }

  const gender = extractGenderFromSaId(idNumber);
  const citizenship = extractCitizenshipFromSaId(idNumber);

  return {
    valid: errors.length === 0 && checksum,
    checksum,
    dob,
    gender,
    citizenship,
    errors,
  };
}
