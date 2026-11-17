import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

const instant = z.iso.datetime({ offset: true });
/** api.get_my_intro_trial: the member's free week. It starts when the first
 * post is approved, so only a running week has a start and an end. */
export const introTrialSchema = z
  .strictObject({
    status: z.enum(["available", "awaiting_approval", "running", "used", "unavailable"]),
    starts_at: instant.nullable(),
    ends_at: instant.nullable(),
  })
  .refine(
    (value) =>
      (value.status === "running") === (value.starts_at !== null) &&
      (value.starts_at === null) === (value.ends_at === null) &&
      (value.starts_at === null || Date.parse(value.starts_at) < Date.parse(value.ends_at ?? ""))
  );
export type IntroTrial = z.infer<typeof introTrialSchema>;

export async function readIntroTrial(api: FoundationAuthenticatedApi): Promise<IntroTrial> {
  const result = await api.rpc("get_my_intro_trial", {}, { get: false });
  if (result.error) throw new Error("Introductory trial is unavailable");
  return introTrialSchema.parse(result.data);
}

/** The restored dashboard card's trial record (its `intro_trial_claims` row
 * shape) for a free week that is running or waiting for its post's approval;
 * nothing otherwise. Presentation only. */
export type RestoredTrialClaim = {
  id: string;
  duration_days: number;
  admin_granted: false;
  activated_at: string | null;
  expires_at: string | null;
  released_at: null;
  converted_at: null;
};
const DAY_MS = 86_400_000;
export function restoredTrialClaim(trial: IntroTrial): RestoredTrialClaim | null {
  const base = {
    id: "intro-trial",
    admin_granted: false as const,
    released_at: null,
    converted_at: null,
  };
  if (trial.status === "running" && trial.starts_at && trial.ends_at)
    return {
      ...base,
      duration_days: Math.round((Date.parse(trial.ends_at) - Date.parse(trial.starts_at)) / DAY_MS),
      activated_at: trial.starts_at,
      expires_at: trial.ends_at,
    };
  if (trial.status === "awaiting_approval")
    return { ...base, duration_days: 7, activated_at: null, expires_at: null };
  return null;
}
