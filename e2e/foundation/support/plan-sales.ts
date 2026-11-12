import { queryTestCopy } from "./test-copy";

/**
 * Paid plans are paused: the switch to the current Terms
 * (database/foundation/updates/20261112173841_switch_posting_terms_v4.sql)
 * takes every plan off sale, so the copy sells nothing. The checkout specs
 * still prove the money path: before their tests they put a copy of each plan
 * the switch paused on sale (a new version of the same plan code, as a later
 * catalogue update would), and afterwards take those copies off sale again,
 * so every other spec sees the paused site. Specs run one at a time
 * (playwright.foundation.config.ts, one worker).
 */
export function openTestPlanSales(): void {
  queryTestCopy(
    "insert into private.plan_versions (plan_code, version, area, label, price_cents, currency, " +
      "duration_days, slot_capacity, activations_per_period, activation_period_days, max_photos, " +
      "max_videos, addon_capabilities) " +
      "select p.plan_code, (select max(x.version) + 1 from private.plan_versions x where x.plan_code = p.plan_code), " +
      "p.area, p.label, p.price_cents, p.currency, p.duration_days, p.slot_capacity, " +
      "p.activations_per_period, p.activation_period_days, p.max_photos, p.max_videos, p.addon_capabilities " +
      "from private.plan_versions p join private.plan_sale_pauses s on s.plan_version_id = p.id " +
      "where not exists (select 1 from private.plan_versions q where q.plan_code = p.plan_code " +
      "and q.is_public and q.retired_at is null);"
  );
}

/** Takes the copies {@link openTestPlanSales} put on sale off sale again. */
export function closeTestPlanSales(): void {
  queryTestCopy(
    "update private.plan_versions set retired_at = now() where is_public and retired_at is null " +
      "and plan_code in (select p.plan_code from private.plan_versions p " +
      "join private.plan_sale_pauses s on s.plan_version_id = p.id);"
  );
}
