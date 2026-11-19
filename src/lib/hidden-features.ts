/**
 * Features hidden until they work on the live backend (owner's frontend rule 2:
 * a feature may be hidden until it works; each one is listed in
 * FRONTEND-CHANGES.md for the owner to review). Turning one back on is a
 * frontend change that needs the owner's approval.
 *
 * Typed as `boolean`, not as the literal, so the code behind each switch still
 * type-checks and can be switched back on without other edits.
 *
 * Every switch is off (false) in production. LAUNCH_CONFIG_BUILD is true only
 * in the launch-configuration browser-test build of the local test copy, where
 * each switch takes its launch-day value from LAUNCH_VALUES
 * (src/lib/launch-config.ts); a production build cannot be made with it.
 */

import { LAUNCH_CONFIG_BUILD, LAUNCH_VALUES } from "@/lib/launch-config";

/**
 * View counts, the like button and like totals. The live backend stores them
 * from database update 20261119172135_post_views_and_likes.sql; while this is
 * off, the view and like routes answer 204 without storing anything and no
 * page reads the totals. On at launch (LAUNCH_VALUES), once the owner approves
 * showing them (frontend ledger, group "awaiting owner").
 */
export const SHOW_ENGAGEMENT_TOTALS: boolean =
  LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_ENGAGEMENT_TOTALS;

/**
 * The member "Performance" page (/dashboard/metrics) and the links to it. The
 * page reads statistics the live backend does not record, so it was broken or
 * empty. While hidden, its address leads to the dashboard. To be rebuilt
 * after launch (OD-07).
 */
export const SHOW_OWNER_METRICS: boolean = LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_OWNER_METRICS;

/**
 * The "Detect province and city" button in the verification location step.
 * Its route (/api/verification/location/detect) suggests a listed province
 * and city from Cloudflare's request location and saves nothing. Hidden until
 * launch (owner decision: shown at launch; frontend ledger group 58);
 * meanwhile members pick their province and city from the list.
 */
export const SHOW_LOCATION_DETECTION: boolean =
  LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_LOCATION_DETECTION;

/**
 * Staff "Operations health" page (/admin/operations), its menu entry, the
 * links to it on the staff home, and its "Retry" route
 * (/api/admin/ops/jobs/retry). They read job, incident and retention records
 * the live backend does not have. While hidden, the page's address leads to
 * the staff home and the route answers 404.
 */
export const SHOW_STAFF_OPERATIONS: boolean =
  LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_STAFF_OPERATIONS;

/**
 * The "Performance" tab of an organisation's dashboard, with its two "CSV"
 * download links, and the route behind them (/api/organisations/<id>/report).
 * The live backend has no programme report yet, so the tab held only the
 * links, and the downloads failed. While hidden, the route answers 404.
 */
export const SHOW_ORGANISATION_REPORT: boolean =
  LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_ORGANISATION_REPORT;

/**
 * "Delete account" on the profile's Account tab, its confirmation dialog, and
 * the route behind it (/api/account/delete), which closes the account through
 * api.close_my_account (M1.6c). Hidden until the owner approves it (frontend
 * ledger group 43). While hidden, the tab says to send a data request instead
 * and the route answers 404.
 */
export const SHOW_ACCOUNT_DELETION: boolean =
  LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_ACCOUNT_DELETION;

/**
 * Paid add-ons (Urgent, Boost, Featured) where they are offered or listed as
 * included: the "Get more eyes on a post" section on Advertise and the
 * "Urgent label add-on" line on the plan cards, and "Boost and Featured" on the
 * showroom help page. Add-on sales are paused
 * (ADDON_SALES_ENABLED) and paid add-ons do not deliver yet (roadmap M1.10),
 * so the pages promised something nobody could buy.
 */
export const SHOW_PAID_ADDONS: boolean = LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_PAID_ADDONS;

/**
 * The Business Sponsor offer: the sponsor package, founding pilots, sample
 * partner report and sponsor questions on Advertise, and the "Become a
 * Business Sponsor" buttons and call to action on the home page and
 * Business Sponsors page, the sponsor card and fees on the (hidden) pricing
 * package section, and "See programme prices" on an organisation dashboard.
 * The sponsor programme is on hold by the owner's
 * decision, and the Terms (posting-v5) sell no sponsor package. Existing
 * sponsors and the businesses they support are still listed.
 */
export const SHOW_SPONSOR_OFFER: boolean = LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_SPONSOR_OFFER;

/**
 * "You + 1 person (you + 4 from 50 slots)" on the (hidden) Multi-listing page.
 * Package teams are not built yet (roadmap P4c), so a package has one person.
 */
export const SHOW_PACKAGE_TEAMS: boolean = LAUNCH_CONFIG_BUILD && LAUNCH_VALUES.SHOW_PACKAGE_TEAMS;
