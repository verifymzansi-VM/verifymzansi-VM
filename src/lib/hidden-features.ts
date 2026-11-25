/**
 * Switches for features that were hidden until they worked on the live backend
 * (owner's frontend rule 2; each one is listed in FRONTEND-CHANGES.md).
 *
 * Every switch is on (true) in production and in every build, by the owner's
 * decision of 22 November 2026: hide nothing while the site is pre-launch (sign-up
 * is invite only and the owner checks each function before inviting anyone).
 * Two stay off because what they show is not built (the review of launch
 * checklist item 71): SHOW_ORGANISATION_REPORT and SHOW_PACKAGE_TEAMS.
 * Changing a switch is a frontend change that needs the owner's approval.
 *
 * Typed as `boolean`, not as the literal, so the code on both sides of each
 * switch still type-checks and a switch can be turned off without other edits.
 */

/**
 * View counts, the like button and like totals. The live backend stores them
 * from database update 20261119172135_post_views_and_likes.sql. If switched
 * off, the view and like routes answer 204 without storing anything and no
 * page reads the totals.
 */
export const SHOW_ENGAGEMENT_TOTALS: boolean = true;

/**
 * The member "Performance" page (/dashboard/metrics) and the links to it. The
 * page reads the live backend's api.get_my_post_performance (frontend ledger
 * group 81); it starts empty until views are recorded. If switched off, its
 * address leads to the dashboard.
 */
export const SHOW_OWNER_METRICS: boolean = true;

/**
 * The "Detect province and city" button in the verification location step.
 * Its route (/api/verification/location/detect) suggests a listed province
 * and city from Cloudflare's request location and saves nothing (frontend ledger
 * group 58). Members can still pick their province and city from the list.
 */
export const SHOW_LOCATION_DETECTION: boolean = true;

/**
 * Staff "Operations health" page (/admin/operations), its menu entry and the
 * links to it on the staff home. The page reads the live backend's staff
 * command api.get_staff_operations_health (database update
 * 20261120163500_staff_operations_health.sql): late scheduled jobs, stuck
 * emails and notices, payment problems and blocked deletions (frontend ledger
 * group 70). If switched off, the page's address leads to the staff home.
 */
export const SHOW_STAFF_OPERATIONS: boolean = true;

/**
 * The "Performance" tab of an organisation's dashboard, with its two "CSV"
 * download links, and the route behind them (/api/organisations/<id>/report).
 * Off: the report is not built on the live database yet; checklist item 46
 * ("Sponsors, part B: the pilot", which includes report version 1).
 * Its route still reads the retired backend, so the downloads would fail.
 * While off, the tab is hidden and the route answers 404.
 */
export const SHOW_ORGANISATION_REPORT: boolean = false;

/**
 * Post templates (business tools plan section 4, item 17b): "Save as template"
 * on the "Edit listing" form and "Start from a template" on Create Post (shown
 * only once a template exists and while the Multi-listing package runs), which
 * opens the "Post an item" form filled in. Calls the live backend's
 * api.save_my_post_template, api.list_my_post_templates,
 * api.rename_my_post_template and api.delete_my_post_template (database update
 * 20261122191646_post_templates.sql). Frontend ledger group 87. If switched
 * off, the pages are as before and /api/post-templates answers 404.
 */
export const SHOW_POST_TEMPLATES: boolean = true;

/**
 * "Delete account" on the profile's Account tab, its confirmation dialog, and
 * the route behind it (/api/account/delete), which closes the account through
 * api.close_my_account (M1.6c). Frontend ledger group 43. If
 * switched off, the tab says to send a data request instead and the route
 * answers 404.
 */
export const SHOW_ACCOUNT_DELETION: boolean = true;

/**
 * The Business Sponsor offer: the sponsor package, founding pilots, sample
 * partner report and sponsor questions on Advertise, and the "Become a
 * Business Sponsor" buttons and call to action on the home page and
 * Business Sponsors page, the sponsor card and fees on the pricing
 * package section, and "See programme prices" on an organisation dashboard.
 * The Terms (posting-v5) sell no sponsor package
 * yet. Existing sponsors and the businesses they support are listed either way.
 */
export const SHOW_SPONSOR_OFFER: boolean = true;

/**
 * "You + 1 person (you + 4 from 50 slots)" on the Multi-listing page.
 * Off: package teams are not built yet (checklist item 15; roadmap P4c), so a
 * package has one person.
 */
export const SHOW_PACKAGE_TEAMS: boolean = false;

/**
 * The redesigned partner page (/dashboard/partner, frontend ledger group 80):
 * this month's earnings and next payout on the green band, sharing (link,
 * code, WhatsApp, QR download), progress, money and help. The partner
 * agreement is not signed yet. If switched off, partners see the earlier page.
 */
export const SHOW_PARTNER_PAGE: boolean = true;

/**
 * The storefront of a Multi-listing package (business tools plan section 1,
 * item 17b): "All stock" on the package owner's checked business page, and on
 * each listing in it the business's name and "See all N cars". Reads the live
 * backend's api.get_public_storefront and the search filter 'storefront'
 * (database update 20261121131915_business_storefront.sql). Frontend ledger
 * group 85. If switched off, both pages are as before and /api/listings
 * refuses the storefront filters.
 */
export const SHOW_BUSINESS_STOREFRONT: boolean = true;

/**
 * Copy a post (business tools plan section 3, item 17b): "More", then "Copy
 * this post" on My posts for a member whose Multi-listing package runs; the
 * copy opens in the "Post an item" form as a draft, unfinished copies wait under
 * "Drafts" on My posts, and reviewers see "Copied from".
 * Calls the live backend's api.copy_my_post and
 * api.get_frontend_staff_copy_facts (database update
 * 20261121150309_copy_a_post.sql). Frontend ledger group 86. If switched
 * off, My posts, the form and the review queue are as before and
 * /api/listings/[id]/copy answers 404.
 */
export const SHOW_POST_COPY: boolean = true;
