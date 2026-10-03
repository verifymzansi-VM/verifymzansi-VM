/** The CLI may append update notices to JSON output. Parse only its first
 * complete object, without treating braces inside quoted values as boundaries. */
export function parseSupabaseStatus(output: string) {
  const beginning = output.match(/^\s*\{/m);
  if (!beginning || beginning.index === undefined) throw new Error("Missing Supabase status JSON");
  const start = output.indexOf("{", beginning.index);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < output.length; index++) {
    const character = output[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      let value: unknown;
      try {
        value = JSON.parse(output.slice(start, index + 1));
      } catch {
        throw new Error("Invalid Supabase status JSON");
      }
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid Supabase status object");
      const status = value as Record<string, unknown>;
      for (const name of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"])
        if (typeof status[name] !== "string" || !status[name].trim())
          throw new Error(`Missing Supabase status field ${name}`);
      const api = new URL(status.API_URL as string);
      if (
        !["127.0.0.1", "localhost"].includes(api.hostname) ||
        api.protocol !== "http:" ||
        api.port !== "56421" ||
        api.username ||
        api.password ||
        api.search ||
        api.hash ||
        (api.pathname !== "/" && api.pathname !== "")
      )
        throw new Error("Refusing non-isolated database target");
      return status as { API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string };
    }
  }
  throw new Error("Incomplete Supabase status JSON");
}
