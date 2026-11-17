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

/**
 * The member "Performance" page (/dashboard/metrics) and the links to it. The
 * page reads statistics the live backend does not record, so it was broken or
 * empty. While hidden, its address leads to the dashboard. To be rebuilt
 * after launch (OD-07).
 */
export const SHOW_OWNER_METRICS: boolean = false;

/**
 * The "Detect province and city" button in the verification location step.
 * The live backend has no location suggestion, so the button only failed;
 * members pick their province and city from the list (OD-07).
 */
export const SHOW_LOCATION_DETECTION: boolean = false;

/**
 * Staff "Commercial settings" page (/admin/commercial) and its menu entry. The
 * page reads prices and settings from tables the live backend does not have,
 * so it only showed an error. While hidden, its address leads to the staff
 * home.
 */
export const SHOW_STAFF_COMMERCIAL_SETTINGS: boolean = false;

/**
 * Staff "Free posts & trials" page (/admin/trials), its menu entry, the
 * "Offer a pilot extension" link on a staff organisation page, and the route
 * the page saves through (/api/admin/trials). They read and change trial
 * records the live backend does not have. While hidden, the page's address
 * leads to the staff home and the route answers 404.
 */
export const SHOW_STAFF_TRIALS: boolean = false;

/**
 * Staff "Programmes & contracts" page (/admin/programmes) and its menu entry.
 * The page reads contracts and slot records the live backend does not have.
 * While hidden, its address leads to the staff home.
 */
export const SHOW_STAFF_PROGRAMMES: boolean = false;

/**
 * Staff "Operations health" page (/admin/operations), its menu entry, the
 * links to it on the staff home, and its "Retry" route
 * (/api/admin/ops/jobs/retry). They read job, incident and retention records
 * the live backend does not have. While hidden, the page's address leads to
 * the staff home and the route answers 404.
 */
export const SHOW_STAFF_OPERATIONS: boolean = false;

/**
 * The six staff "Intelligence" pages (/admin/intelligence/*) and their menu
 * section. They count rows in tables the live backend does not have. While
 * hidden, their addresses lead to the staff home.
 */
export const SHOW_STAFF_INTELLIGENCE: boolean = false;

/**
 * The "Performance" tab of an organisation's dashboard, with its two "CSV"
 * download links, and the route behind them (/api/organisations/<id>/report).
 * The live backend has no programme report yet, so the tab held only the
 * links, and the downloads failed. While hidden, the route answers 404.
 */
export const SHOW_ORGANISATION_REPORT: boolean = false;

/**
 * "Renew using my paid plan" and "Switch pending post to 7 days" on the
 * dashboard's trial card, and the route behind them (/api/trials). The live
 * backend has no way to change a free week yet. While hidden, the route
 * answers 404.
 */
export const SHOW_TRIAL_PLAN_CHANGES: boolean = false;

/**
 * The trial extension offer card on an organisation's dashboard and the route
 * that accepts or declines an offer (/api/trial-extensions/<id>). The live
 * backend has no extension offers yet, so the card never showed. While hidden,
 * the route answers 404.
 */
export const SHOW_TRIAL_EXTENSION_OFFERS: boolean = false;

/**
 * Paid add-ons (Urgent, Boost, Featured) where they are offered or listed as
 * included: the "Get more eyes on a post" section on Advertise and the
 * "Urgent label add-on" line on the plan cards, and "Boost and Featured" on the
 * showroom help page. Add-on sales are paused
 * (ADDON_SALES_ENABLED) and paid add-ons do not deliver yet (roadmap M1.10),
 * so the pages promised something nobody could buy.
 */
export const SHOW_PAID_ADDONS: boolean = false;

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
export const SHOW_SPONSOR_OFFER: boolean = false;

/**
 * "You + 1 person (you + 4 from 50 slots)" on the (hidden) Multi-listing page.
 * Package teams are not built yet (roadmap P4c), so a package has one person.
 */
export const SHOW_PACKAGE_TEAMS: boolean = false;

/**
 * The "Analytics" and "Third-party sharing" switches on the Notifications
 * page's Preferences tab (/dashboard/communication). The site does not use
 * usage analytics or third-party processing yet, so the switches asked for a
 * choice that changed nothing (owner decision 2026-11-16). While hidden, the
 * preferences route refuses to turn either one on; turning one off (the safe
 * default) still works, so a member who chose one earlier can withdraw it.
 */
export const SHOW_DATA_USE_CHOICES: boolean = false;
