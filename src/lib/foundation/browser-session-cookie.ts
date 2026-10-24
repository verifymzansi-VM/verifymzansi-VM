import { getPublicRuntimeConfig } from "../public-runtime-config";

/** A cheap download hint only. The server still verifies the token and live
 * account. Old-project cookies must not count as a London session.
 */
export function hasFoundationBrowserSession() {
  if (typeof document === "undefined") return true;
  let host: string;
  try {
    host = new URL(getPublicRuntimeConfig().supabaseUrl).hostname;
  } catch {
    return false;
  }
  if (host !== "gntzjtuncsyefujajmjy.supabase.co" && host !== "127.0.0.1") return false;
  const base = `sb-${host.split(".")[0]}-auth-token`;
  return document.cookie.split(";").some((part) => {
    const name = part.split("=", 1)[0].trim();
    return (
      name === base || (name.startsWith(base + ".") && /^\d+$/.test(name.slice(base.length + 1)))
    );
  });
}
