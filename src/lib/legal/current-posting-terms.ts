import "server-only";
import { createFoundationPublicApi } from "@/lib/foundation/public-api";
import { readFoundationPostingTerms } from "@/lib/foundation/posting-terms";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import {
  assertPublishedPostingTerms,
  getPublishedPostingTerms,
  postingTermsAwaitingForce,
} from "./published-posting-terms";

export async function readCurrentPublishedPostingTerms() {
  const policy = await readFoundationPostingTerms(
    createFoundationPublicApi(readFoundationRuntimeConnection())
  );
  if (!policy) return null;
  assertPublishedPostingTerms(policy);
  return getPublishedPostingTerms(policy.version);
}

/** The version the database holds as current, or null when it cannot be read. */
async function readDatabaseCurrentVersion() {
  if (!process.env.FOUNDATION_SUPABASE_URL) return null;
  try {
    const policy = await readFoundationPostingTerms(
      createFoundationPublicApi(readFoundationRuntimeConnection())
    );
    return policy?.version ?? null;
  } catch {
    return null;
  }
}

/** Whether a published version is still waiting to come into force, decided
 * from the database's current version (see postingTermsAwaitingForce). */
export async function isPostingTermsVersionAwaitingForce(version: string) {
  return postingTermsAwaitingForce(version, await readDatabaseCurrentVersion());
}
