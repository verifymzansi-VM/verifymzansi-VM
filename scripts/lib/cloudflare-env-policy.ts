/** OpenNext exports .env* files verbatim. Only explicitly public settings may
 * travel in that fallback module; private settings come from Worker bindings. */
export function sanitizeCloudflareEnvModule(source: string) {
  const modes = new Set(["production", "development", "test"]);
  const removed = new Set<string>();
  const output: string[] = [];
  for (const line of source.split(/\r?\n/).filter((line) => line.trim())) {
    const match = line.match(/^export const (production|development|test) = (.+);$/);
    if (!match || !modes.delete(match[1]))
      throw new Error("Invalid or duplicate Cloudflare env export");
    const env: unknown = JSON.parse(match[2]);
    if (!env || typeof env !== "object" || Array.isArray(env))
      throw new Error("Invalid Cloudflare env object");
    const safe: Record<string, string> = {};
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== "string") throw new Error("Invalid Cloudflare env value");
      if (
        name.startsWith("NEXT_PUBLIC_") &&
        !/SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE|ENCRYPTION_KEY/i.test(name)
      )
        safe[name] = value;
      else removed.add(name);
    }
    output.push(`export const ${match[1]} = ${JSON.stringify(safe)};`);
  }
  if (modes.size) throw new Error("Missing Cloudflare env modes");
  return { source: output.join("\n") + "\n", removed: [...removed].sort() };
}
