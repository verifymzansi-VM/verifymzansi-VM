/**
 * Features hidden until they work on the live backend (owner's frontend rule 2:
 * a feature may be hidden until it works; each one is listed in
 * FRONTEND-CHANGES.md for the owner to review). Turning one back on is a
 * frontend change that needs the owner's approval.
 *
 * Typed as `boolean`, not as the literal, so the code behind each switch still
 * type-checks and can be switched back on without other edits.
 */

/**
 * View counts, the like button and like totals. The live backend does not
 * store views or likes yet, so every post showed "0 views" and a like undid
 * itself. To be rebuilt after launch on the new backend.
 */
export const SHOW_ENGAGEMENT_TOTALS: boolean = false;

/**
 * The "Showing <province> first · Change" chip under the showrooms. The live
 * showroom feed does not order posts by province, so the chip promised
 * something the site did not do.
 */
export const SHOW_SHOWROOM_PROVINCE_CHIP: boolean = false;
