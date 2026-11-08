/** The restored profile page's "Set Password" sends only the member's email
 * (no CAPTCHA token); the forgot-password page always sends a non-empty token
 * field (its form schema requires one), so it never matches. */
export function isFoundationPasswordSetupInput(input: unknown) {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).length === 1 &&
    Object.hasOwn(input, "email")
  );
}
