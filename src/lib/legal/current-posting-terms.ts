import "server-only";
import { createFoundationPublicApi } from "@/lib/foundation/public-api";
import { readFoundationPostingTerms } from "@/lib/foundation/posting-terms";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import {
  assertPublishedPostingTerms,
  getPublishedPostingTerms,
  isUpcomingPostingTermsVersion,
} from "./published-posting-terms";

export async function readCurrentPublishedPostingTerms() {
  const policy = await readFoundationPostingTerms(
    createFoundationPublicApi(readFoundationRuntimeConnection())
  );
  if (!policy) return null;
  assertPublishedPostingTerms(policy);
  return getPublishedPostingTerms(policy.version);
}

/** Whether a version published ahead of time is still waiting to come into
 * force. The database decides: the version is in force from the moment a
 * reviewed update makes it current, even before the release that names it
 * active is deployed. When the current version cannot be read, an upcoming
 * version counts as not in force. Earlier versions never wait. */
export async function isPostingTermsVersionAwaitingForce(version: string) {
  if (!isUpcomingPostingTermsVersion(version)) return false;
  if (!process.env.FOUNDATION_SUPABASE_URL) return true;
  try {
    const policy = await readFoundationPostingTerms(
      createFoundationPublicApi(readFoundationRuntimeConnection())
    );
    return policy?.version !== version;
  } catch {
    return true;
  }
}
