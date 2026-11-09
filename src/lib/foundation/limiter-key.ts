/**
 * Shared rate limiter keys for values a person typed, such as an email
 * address: a SHA-256 hex digest instead of the value, so every key has the
 * same short length (the limiter refuses keys over 160 characters) and the
 * limiter never stores the address itself. The prefix keeps digests of
 * different kinds of value apart; callers pass already normalised values.
 */
async function digest(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The key for one email address (`email:` + 64 hex characters). */
export async function limiterAddressKey(email: string) {
  return "email:" + (await digest("email\n" + email));
}

/** The key for one account and one email address together. */
export async function limiterAccountAddressKey(accountId: string, email: string) {
  return "account-email:" + (await digest("account-email\n" + accountId + "\n" + email));
}
