import { z } from "zod";

const configuration = z.strictObject({
  url: z.string().url(),
  expectedProjectRef: z.string(),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]+$/),
});
const existingProjectRefs = new Set([
  "tnygdgormnofpgjknlhr",
  "ubrtdtmumfhjpuegxnhj",
  "pfuurrahjdewiphmjyiq",
  "vlsynwsekujghfufvsxn",
]);

export function parseFoundationConnection(input: unknown) {
  const parsed = configuration.safeParse(input);
  if (!parsed.success) throw new Error("Invalid foundation public connection");
  const config = parsed.data;
  const url = new URL(config.url);
  const local =
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1" &&
    ["55441", "55443"].includes(url.port) &&
    config.expectedProjectRef === "local-foundation";
  const hosted =
    url.protocol === "https:" &&
    url.port === "" &&
    /^[a-z]{20}$/.test(config.expectedProjectRef) &&
    !existingProjectRefs.has(config.expectedProjectRef) &&
    url.hostname === `${config.expectedProjectRef}.supabase.co`;
  if (
    (!local && !hosted) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Unexpected foundation project identity");
  return { ...config, url: url.origin };
}
