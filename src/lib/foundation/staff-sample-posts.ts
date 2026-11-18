import "server-only";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { isStaffSecondFactorRefusal } from "./error-reasons";
import { FoundationStaffCommandError } from "./staff-command";
import { isSampleSlug } from "@/lib/sample-posts/catalogue";

/** Remove (hidden: true) or restore (false) one catalogue sample. */
const sampleVisibilityInput = z.strictObject({
  slug: z.string().refine(isSampleSlug),
  hidden: z.boolean(),
});

const sampleVisibility = z.strictObject({
  slug: z.string(),
  hidden: z.boolean(),
  hidden_at: z.iso.datetime({ offset: true }).nullable(),
});

type SampleVisibility = z.infer<typeof sampleVisibility>;

/**
 * Staff command api.set_sample_post_hidden (post:moderate with a recent
 * authenticator code). Only a slug of the current catalogue is sent. Refusals
 * become FoundationStaffCommandError, which staffCommandRefusal maps (a
 * second-factor refusal sends staff to verify again).
 */
export async function setStaffSamplePostHidden(
  api: FoundationAuthenticatedApi,
  body: unknown,
  catalogueSlugs: ReadonlySet<string>
): Promise<SampleVisibility> {
  const input = sampleVisibilityInput.parse(body);
  if (!catalogueSlugs.has(input.slug))
    throw new FoundationStaffCommandError(
      404,
      "That sample is not in the catalogue. Reload the page."
    );
  const { data, error } = await api.rpc(
    "set_sample_post_hidden",
    { p_slug: input.slug, p_hidden: input.hidden },
    { get: false }
  );
  if (error) {
    if (error.code === "42501")
      throw new FoundationStaffCommandError(
        403,
        isStaffSecondFactorRefusal(error)
          ? "Verify your authenticator again, then reload the page."
          : "Your staff access changed. Reload the page.",
        isStaffSecondFactorRefusal(error)
      );
    if (error.code === "54000")
      throw new FoundationStaffCommandError(
        409,
        "Too many samples are removed. Restore one before removing another."
      );
    throw new FoundationStaffCommandError(
      error.code === "22023" ? 422 : 503,
      "The change could not be confirmed. Reload the page before trying again."
    );
  }
  const parsed = sampleVisibility.safeParse(data);
  if (!parsed.success || parsed.data.slug !== input.slug || parsed.data.hidden !== input.hidden)
    throw new FoundationStaffCommandError(
      503,
      "The change could not be confirmed. Reload the page before trying again."
    );
  return parsed.data;
}
