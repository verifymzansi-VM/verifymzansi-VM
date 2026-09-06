const TRIAL_ERRORS: Record<string, string> = {
  TRIAL_FULL:
    "The 30-day trial pool is full. This post remains pending. The owner can switch to the enabled 7-day option in their dashboard.",
  TRIAL_PAUSED:
    "This trial campaign is paused. The post remains pending until an enabled offer is selected or the campaign resumes.",
  TRIAL_VERIFICATION_REQUIRED:
    "The owner must complete verification before this trial can be approved.",
  TRIAL_USED: "This verified identity has already activated an introductory offer.",
  TRIAL_EXPIRED: "This trial has ended or was released. The owner needs to renew with a paid plan.",
  TRIAL_REQUIRED: "This post needs an introductory offer or an active paid plan before approval.",
  TRIAL_RELEASED: "This reservation was released. The owner needs to select a new offer.",
  TRIAL_EVENT_ENDED: "This event has already ended and cannot activate a trial.",
};
export function trialErrorMessage(message: string): string | null {
  const code = message.split(":", 1)[0];
  return TRIAL_ERRORS[code] ?? null;
}
