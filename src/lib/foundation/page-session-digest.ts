/** Base64url bytes without padding (Web APIs only: the page gate runs on the edge runtime). */
export function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** SHA-256 of an access token, so a page can check that the gate verified the
 * very token its own cookies carry without the token itself travelling again. */
export async function digestFoundationToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}
