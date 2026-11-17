import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { profileUpdateSchema } from "../validations/profile";
import { normalizeSaPhone } from "../utils/phone";
import {
  buildFoundationProfileUpdate,
  foundationAccountProfileSchema,
  FoundationProfileError,
} from "./account-profile";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { createLogger } from "../utils/logger";
import { resolveRestoredLocality, LocalityInputError } from "./restored-locality";
import { hasDatabaseReason } from "./error-reasons";

const log = createLogger("RestoredProfile");
const inputSchema = profileUpdateSchema
  .omit({ displayName: true })
  .extend({
    displayName: z.string().max(101).nullable().optional(),
    expectedRevision: z.number().int().min(1).max(2147483646),
  })
  .strict();
class ProfileRefusal extends Error {
  override name = "ProfileRefusal";
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}
function location(province?: string, city?: string) {
  if (!province && !city) return {};
  return resolveRestoredLocality(province ?? "", city ?? "");
}
export function handleRestoredProfileUpdate(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "profile:update",
    mutate: true,
    unavailableMessage: "Your profile is temporarily unavailable",
    signInMessage: "Sign in to manage your profile",
    command: async (api, input) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success)
        throw new ProfileRefusal(400, "Reload your profile and check the details before saving");
      const value = parsed.data;
      const account = await readFoundationAccountContext(api);
      if (value.phone && normalizeSaPhone(value.phone) !== account.phone)
        throw new ProfileRefusal(
          403,
          "Verify your new phone number before changing it",
          "PHONE_REVERIFICATION_REQUIRED"
        );
      if (value.avatarUrl)
        throw new ProfileRefusal(400, "Upload your avatar through the profile page");
      const locked = account.profile.legal_name_locked;
      if (
        locked &&
        value.displayName != null &&
        value.displayName !== (account.profile.public_name ?? account.profile.display_name)
      )
        throw new ProfileRefusal(403, "Your verified name cannot be changed");
      const command = buildFoundationProfileUpdate({
        expected_revision: value.expectedRevision,
        display_name: locked ? null : value.displayName,
        bio: value.bio || null,
      });
      const { data, error } = await api.rpc(
        "save_my_frontend_profile",
        { ...command, ...location(value.province, value.city) },
        { get: false }
      );
      if (error) {
        if (error.code === "42501") throw new FoundationAccountContextError("forbidden");
        if (hasDatabaseReason(error, "profile_changed"))
          throw new ProfileRefusal(412, "Your profile changed. Reload it before saving");
        if (hasDatabaseReason(error, "legal_name_locked"))
          throw new ProfileRefusal(403, "Your verified name cannot be changed");
        if (error.code === "PT409")
          throw new ProfileRefusal(
            403,
            "Your confirmed location cannot be changed here. Request a verification review"
          );
        if (error.code === "22023")
          throw new ProfileRefusal(400, "Check your name, bio, province and city");
        throw new Error("Profile save unavailable");
      }
      const saved = foundationAccountProfileSchema.parse(data);
      return {
        success: true,
        profile: {
          display_name: saved.public_name ?? saved.display_name,
          bio: saved.bio,
          phone: account.phone,
          revision: saved.revision,
        },
      };
    },
    refusal: (error) => {
      if (error instanceof LocalityInputError)
        return { status: 400, error: error.message, reason: "location_invalid" };
      if (error instanceof ProfileRefusal)
        return {
          status: error.status,
          error: error.message,
          reason: error.code ?? "profile_refused",
          code: error.code,
        };
      if (error instanceof FoundationProfileError)
        return { status: 400, error: "Check your name and bio", reason: error.reason };
      if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
        return {
          status: 403,
          error: "Account access is unavailable",
          reason: "account_access_unavailable",
        };
      return null;
    },
  });
}
