import { z } from "zod";
import type { FoundationPublicApi } from "./public-api";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const version = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const hash = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .pipe(z.iso.datetime({ offset: true }));
const document = z
  .strictObject({ version, document_hash: hash, document_path: z.string() })
  .refine((value) => value.document_path === `/terms/versions/${value.version}`);
const ownerDocument = z
  .strictObject({
    version,
    document_hash: hash,
    document_path: z.string(),
    accepted_at: instant.nullable(),
  })
  .refine((value) => value.document_path === `/terms/versions/${value.version}`);
const consent = z.strictObject({ version, document_hash: hash, accepted: z.literal(true) });
export type FoundationPostingTerms = z.infer<typeof document>;
export type FoundationOwnerPostingTerms = z.infer<typeof ownerDocument>;

export function parseFoundationPostingTerms(value: unknown): FoundationPostingTerms | null {
  if (value === null) return null;
  const parsed = document.safeParse(value);
  if (!parsed.success) throw new Error("Invalid foundation posting terms");
  return parsed.data;
}
export function parseFoundationOwnerPostingTerms(
  value: unknown
): FoundationOwnerPostingTerms | null {
  if (value === null) return null;
  const parsed = ownerDocument.safeParse(value);
  if (!parsed.success) throw new Error("Invalid foundation posting terms status");
  return parsed.data;
}
export function buildFoundationPostingTermsAcceptance(value: unknown) {
  const parsed = consent.safeParse(value);
  if (!parsed.success)
    throw new Error("Explicit acceptance of the displayed posting terms is required");
  return { p_version: parsed.data.version, p_document_hash: parsed.data.document_hash };
}
export async function readFoundationPostingTerms(api: FoundationPublicApi) {
  const { data, error } = await api.rpc("get_current_posting_terms", {}, { get: true });
  if (error) throw new Error("Posting terms are temporarily unavailable");
  return parseFoundationPostingTerms(data);
}
/** Observation of the caller's acceptance for the currently published version.
 * Submission still rechecks current policy and consent inside its transaction. */
export async function readFoundationOwnerPostingTerms(api: FoundationAuthenticatedApi) {
  const { data, error } = await api.rpc("get_owner_posting_terms", {}, { get: false });
  if (error) throw new Error("Posting terms status is temporarily unavailable");
  return parseFoundationOwnerPostingTerms(data);
}
/** Explicit caller action, one request, no silent replay after uncertain writes. */
export async function acceptFoundationPostingTerms(
  api: FoundationAuthenticatedApi,
  value: unknown
) {
  const command = buildFoundationPostingTermsAcceptance(value);
  const { data, error } = await api.rpc("accept_posting_terms", command, { get: false }).then(
    (result) => result,
    () => {
      throw new Error("Posting terms acceptance could not be confirmed");
    }
  );
  if (error) {
    if (error.code === "PT409" && error.details === "posting_terms_changed")
      throw new Error("Posting terms changed; review the current version");
    throw new Error("Posting terms acceptance could not be confirmed");
  }
  const parsed = parseFoundationOwnerPostingTerms(data);
  if (
    !parsed ||
    parsed.accepted_at === null ||
    parsed.version !== command.p_version ||
    parsed.document_hash !== command.p_document_hash
  )
    throw new Error("Invalid foundation posting terms acceptance");
  return parsed;
}
