/**
 * Labels for the "Actions Today" counts on the area pages. The keys are the
 * database's action kinds; the wording matches the activity feed.
 */
const TODAY_ACTION_LABELS: Record<string, string> = {
  approve: "Content approved",
  reject: "Content rejected",
  dismiss: "Report dismissed",
  resolve: "Report resolved",
};

/** A readable label for an action kind; an unknown kind never shows its raw key. */
export function actionTodayLabel(action: string): string {
  return Object.hasOwn(TODAY_ACTION_LABELS, action) ? TODAY_ACTION_LABELS[action] : "Other action";
}
