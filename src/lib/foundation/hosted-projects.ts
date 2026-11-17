// The two hosted foundation projects this website may use. Production serves
// the live site; staging is a separate, empty copy for rehearsals (M0.15b).
// Which one a server may use is decided by the Worker's own ENVIRONMENT
// setting (wrangler.toml), never by a request: only the staging Worker sets
// ENVIRONMENT="staging", and only it may reach the staging project.
export const PRODUCTION_PROJECT_REF = "gntzjtuncsyefujajmjy";
export const STAGING_PROJECT_REF = "vgplszqfcmdskwseoyam";

/** The hosted project a server running with this ENVIRONMENT may use. */
export function approvedHostedProjectRef(environment: string | undefined): string {
  return environment === "staging" ? STAGING_PROJECT_REF : PRODUCTION_PROJECT_REF;
}

/**
 * The hosted project a browser bundle was built for. The build guard
 * (next.config.js) only lets a staging build name the staging project, so the
 * browser accepts exactly the two hosted projects and nothing else.
 */
export function browserHostedProjectRef(hostname: string): string {
  return hostname === `${STAGING_PROJECT_REF}.supabase.co`
    ? STAGING_PROJECT_REF
    : PRODUCTION_PROJECT_REF;
}

export const HOSTED_SUPABASE_HOSTS: readonly string[] = [
  `${PRODUCTION_PROJECT_REF}.supabase.co`,
  `${STAGING_PROJECT_REF}.supabase.co`,
];
