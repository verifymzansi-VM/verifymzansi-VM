import "server-only";
import { createFoundationPublicApi } from "@/lib/foundation/public-api";
import { readFoundationPostingTerms } from "@/lib/foundation/posting-terms";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { assertPublishedPostingTerms, getPublishedPostingTerms } from "./published-posting-terms";

export async function readCurrentPublishedPostingTerms() {
  const policy = await readFoundationPostingTerms(
    createFoundationPublicApi(readFoundationRuntimeConnection())
  );
  if (!policy) return null;
  assertPublishedPostingTerms(policy);
  return getPublishedPostingTerms(policy.version);
}
