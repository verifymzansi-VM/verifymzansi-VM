import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { isPersonName, isReservedPersonName, normalizePersonName } from "./person-name";

// Same character rule as internal.profile_bio_valid.
const unsafeBio =
  /[\u0001-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u;
const revision = z.number().int().min(1).max(2147483646);
const personName = z.string().max(400).transform(normalizePersonName).refine(isPersonName);
const bio = z
  .string()
  .max(2000)
  .transform((value) =>
    value
      .replace(/\r\n?/g, "\n")
      .replace(/^[ \n]+|[ \n]+$/g, "")
      .normalize("NFC")
  )
  .refine((value) => Array.from(value).length <= 300 && !unsafeBio.test(value))
  .transform((value) => value || null)
  .nullable();
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
  .pipe(z.iso.datetime({ offset: true }));
const profile = z.strictObject({
  display_name: z.string().nullable(),
  public_name: z.string().nullable(),
  bio: z.string().nullable(),
  avatar_object_id: z.uuid().nullable(),
  legal_first_name: z.string().nullable(),
  legal_last_name: z.string().nullable(),
  legal_name_locked: z.boolean(),
  identity_verified: z.boolean(),
  revision: z.number().int().min(1).max(2147483647),
  updated_at: instant,
});
export type FoundationAccountProfile = z.infer<typeof profile>;

export class FoundationProfileError extends Error {
  constructor(
    readonly reason:
      | "invalid"
      | "reserved"
      | "locked"
      | "changed"
      | "legal_name_required"
      | "avatar_unavailable"
      | "unavailable"
  ) {
    super(`Foundation profile request failed: ${reason}`);
  }
}

function parseProfile(value: unknown) {
  const parsed = profile.safeParse(value);
  if (!parsed.success) throw new FoundationProfileError("unavailable");
  return parsed.data;
}

const commandReasons = new Map<string, FoundationProfileError["reason"]>([
  ["display_name_invalid", "invalid"],
  ["bio_invalid", "invalid"],
  ["legal_name_invalid", "invalid"],
  ["display_name_reserved", "reserved"],
  ["legal_name_locked", "locked"],
  ["profile_changed", "changed"],
  ["legal_name_required", "legal_name_required"],
  ["avatar_unavailable", "avatar_unavailable"],
]);

type ProfileRpc = PromiseLike<{
  data: unknown;
  error: { code?: string; details?: string | null } | null;
}>;
/** One request, no automatic retry after an uncertain reply. */
async function settle(request: ProfileRpc) {
  const { data, error } = await Promise.resolve(request).then(
    (result) => result,
    () => {
      throw new FoundationProfileError("unavailable");
    }
  );
  if (error) {
    const known = error.code === "PT409" || error.code === "22023";
    throw new FoundationProfileError(
      (known && error.details && commandReasons.get(error.details)) || "unavailable"
    );
  }
  return parseProfile(data);
}

export function readFoundationAccountProfile(api: FoundationAuthenticatedApi) {
  return settle(api.rpc("get_my_profile"));
}

const profileInput = z.strictObject({
  expected_revision: revision,
  display_name: personName.nullable(),
  bio: bio.optional(),
});
/** Display name and bio. Pass null for display_name once the legal name is
 * locked; SQL refuses any change to a locked name. */
export function buildFoundationProfileUpdate(input: unknown) {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) throw new FoundationProfileError("invalid");
  const { expected_revision, display_name, bio: nextBio } = parsed.data;
  // Omitted optional arguments are SQL nulls: a locked name is not resent and
  // an empty bio clears it.
  return {
    p_expected_revision: expected_revision,
    ...(display_name === null ? {} : { p_display_name: display_name }),
    ...(nextBio == null ? {} : { p_bio: nextBio }),
  };
}
/** Client check before the request; SQL applies the same rule to changes. */
export function isAllowedNewDisplayName(value: string) {
  const name = normalizePersonName(value);
  return isPersonName(name) && !isReservedPersonName(name);
}
export function saveFoundationAccountProfile(api: FoundationAuthenticatedApi, input: unknown) {
  return settle(api.rpc("save_my_profile", buildFoundationProfileUpdate(input)));
}

const legalNameInput = z.strictObject({
  expected_revision: revision,
  first_name: personName,
  last_name: personName,
});
export function buildFoundationLegalNameClaim(input: unknown) {
  const parsed = legalNameInput.safeParse(input);
  if (!parsed.success) throw new FoundationProfileError("invalid");
  return {
    p_expected_revision: parsed.data.expected_revision,
    p_first_name: parsed.data.first_name,
    p_last_name: parsed.data.last_name,
  };
}
/** Unreviewed claim for the next identity submission; never a verified name. */
export function saveFoundationLegalNameClaim(api: FoundationAuthenticatedApi, input: unknown) {
  return settle(api.rpc("save_my_legal_name", buildFoundationLegalNameClaim(input)));
}

const avatarInput = z.strictObject({ expected_revision: revision, object_id: z.uuid().nullable() });
export function setFoundationAvatar(api: FoundationAuthenticatedApi, input: unknown) {
  const parsed = avatarInput.safeParse(input);
  if (!parsed.success) throw new FoundationProfileError("invalid");
  return settle(
    api.rpc("set_my_avatar", {
      p_expected_revision: parsed.data.expected_revision,
      // Omitted means remove the avatar.
      ...(parsed.data.object_id === null
        ? {}
        : { p_object_id: parsed.data.object_id.toLowerCase() }),
    })
  );
}
