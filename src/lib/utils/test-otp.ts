export const TEST_OTP_CODE = "999999";

export function getTestPhones(): Set<string> {
  const raw = process.env.TEST_PHONE_NUMBERS ?? "";
  return new Set(
    raw
      .split(",")
      .map((phone) => phone.trim())
      .filter(Boolean)
  );
}

export function isWhitelistedTestPhone(phone: string): boolean {
  return getTestPhones().has(phone);
}
