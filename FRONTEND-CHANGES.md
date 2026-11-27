# Frontend changes since the chosen version

The owner chose the frontend of commit `0b562f42` (Cloudflare version
`6356f78f`, see `FRONTEND-RESTORE.md`). This ledger lists every file in that
frontend that differs from it today, so that each difference is either approved
by the owner or put back.

`pnpm check:frontend-freeze` compares the restored scope (`src/components`,
`src/hooks`, `src/stores`, `src/styles`, `public`, `tailwind.config.ts` and the
`.tsx`, `.css` and `.scss` files under `src/app`) with `0b562f42`. It runs in CI
inside the required `lint-type-security` job and fails when:

- a file differs and has no row here;
- a listed file changed after its row was written (the Version column holds the
  first 12 characters of the file's git blob id);
- a row names a file that matches `0b562f42` again (move that row to "Put
  back");
- a row is malformed or listed twice;
- two groups share a number, a group heading and the summary table's rows do
  not match one to one, or the summary table stores counts (a Files column or
  a Total row).

## Owner's standing rules for the frontend

1. A screen may be returned to `0b562f42` unless the owner approved the change.
2. A feature may be hidden until it works, recorded in a list the owner reviews.
3. Very large files may be split only when screenshot checks show no change,
   with the owner's sign-off each time.
4. Anything new or redesigned goes to the owner first.

## How to change a frontend file

1. Make the change. `pnpm check:frontend-freeze` now fails for that file.
2. Add or update its row: kind (`rewiring`, `wording-behaviour`, `visual`,
   `test` or `helper`), a plain reason, what changes on screen, the proposal
   (`keep` or `put back`), decision `awaiting owner` for anything visitors or
   staff see differently, and today's date.
3. Run `pnpm check:frontend-freeze --update-versions` to record the file's new
   version, then run the check again.
4. To put a file back: `git checkout 0b562f42 -- <file>`, then move its row to
   "Put back" below.

To keep clashes between open pull requests in this file small:

- Store no counts. The check prints each group's file count, the total and the
  next unused group number; the summary table has no Files column or Total row.
- Every group has one `### N. Title` section between the markers and exactly
  one summary row starting `N.`; the check fails otherwise. A group without
  file rows says so in its summary row, for example "(no file rows: email
  only)".
- A new group takes the next unused number (gaps are fine). Add its section
  just above `<!-- frontend-ledger:end -->` and its summary row at the end of
  the summary table. Never renumber existing groups.
- Two pull requests that each add a new group still touch the same two spots
  (the end of the summary table and the line above the end marker), so git
  reports a conflict there. Keep both sides; if the check then says a number is
  already used, renumber the newer group (heading, summary row and any "group
  N" mentions).
- Prettier does not format this file (`.prettierignore`), so tables are never
  re-padded. Write new rows as `| a | b |` without lining up the columns; edit
  existing rows in place.

The decision column changes only with the owner's answer. "awaiting owner" means
the owner has not decided yet; the proposal is the engineers' suggestion.

## Summary for the owner

| Group                                        | Proposed                                                                                      | What visitors notice                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Phone and tablet filter (no file rows: 3 put back) | put back (owner, 2026-11-09)                                                                  | The right-edge Filters tab is back on phones and tablets                                                                                                                                                                                                                                                                                                                                                 |
| 2. Member and public wording or behaviour    | keep (owner, 2026-11-09; M2.3 rows 2026-11-10; M2.7, M9.2, M9.4 and M10.1 rows 2026-11-12)    | Billing, contact, dashboard, privacy, help and email-change texts; posts deleted 3 days after they end or are sold, events at their end; the dashboard trial card shows the free week's end date                                                                                                                                                                                                         |
| 3. Staff screens only                        | keep                                                                                          | Nothing; staff screens follow the new backend's review rules                                                                                                                                                                                                                                                                                                                                             |
| 4. Rewiring only                             | keep                                                                                          | Nothing new; the same pages read from the new backend (event pages show their host business card again, as in the chosen version)                                                                                                                                                                                                                                                                        |
| 5. Tests and helpers                         | keep                                                                                          | Nothing; not part of any page                                                                                                                                                                                                                                                                                                                                                                            |
| 6. Hidden until it works                     | keep (owner, 2026-11-10; M4.1, M9.4 and M10.1 parts 2026-11-12)                               | No '0 views', no like button, no 'Showing <province> first' chip                                                                                                                                                                                                                                                                                                                                         |
| 7. Request reference on error pages          | keep (owner, 2026-11-12)                                                                      | Error pages show Cloudflare's request number as the support reference, in the same line as before                                                                                                                                                                                                                                                                                                        |
| 8. Videos shown as videos (M4.1)             | keep (owner, 2026-11-12)                                                                      | Video posts show their video tile (poster and play button) on cards and in the showroom, as in the chosen version, instead of a generic picture                                                                                                                                                                                                                                                          |
| 9. Lighter pages on phones                   | keep (owner, 2026-11-12)                                                                      | Nothing: the same pages and animations; less code downloads and runs at the start                                                                                                                                                                                                                                                                                                                        |
| 10. Keyboard and small fixes (M10.1)         | keep (owner, 2026-11-12)                                                                      | Contact dialogs give focus back; darker text on the selected Events tab; 'No stays or events yet'; a pause button on the desktop showroom; signed-out visitors get 'Go to homepage' on the error page                                                                                                                                                                                                    |
| 11. Consistent details (M10.2)               | keep (owner, 2026-11-12, with the M10.2 part of 11 rows elsewhere)                            | One price format ('R1 450') on cards, the showroom and post pages; 'Free' for free items; no letter-spaced capitals; the theme button no longer covers the logo on narrow phones                                                                                                                                                                                                                         |
| 12. Content-first home (M10.3)               | keep (owner, 2026-11-12, with the M10.3 part of 6 rows elsewhere)                             | The home page opens on the showroom with no pop-up (the pop-up is back since 18 November 2026: returned to the 27 Oct baseline at owner's request; reverses part of group 12; the owner keeps the rest of group 12); one slim line under it, 'Every poster ID-reviewed · What we check'; an area with no posts shows one 'be the first' card instead of a 'No ... yet' box                                                                                                                                                                                                |
| 13. Business contact (M10.8)                 | keep (owner, 2026-11-12, with the M10.8 part of 3 rows elsewhere)                             | Businesses without a public number get the bottom contact bar with 'Send an enquiry'; the 'are you human' check before a number is out of sight or a small box that fits a 320 px phone; no 'No contact details added.' under an email or website                                                                                                                                                        |
| 14. First phone screen (M10.6)               | keep (owner, 2026-11-12, with the M10.6 part of 7 rows elsewhere)                             | Phones: the post's price, title and place on its main photo, as on the showroom card; on short screens the photo frame stops above the contact bar                                                                                                                                                                                                                                                       |
| 15. Sign-in and sign-up messages             | keep (owner, 2026-11-12)                                                                      | A Terms and Privacy line under the Google button; clear messages when registration is by invitation or Google sign-in is cancelled                                                                                                                                                                                                                                                                       |
| 16. One terms step                           | keep (owner, 2026-11-12, with the Terms page row in group 2)                                  | Pressing + Post opens the section cards straight away; the terms are accepted only with the tick box on the form; the Terms page header no longer names a version                                                                                                                                                                                                                                        |
| 17. Terms and paid plans paused (P1)         | keep (owner, 2026-11-12)                                                                      | Nothing on the Terms page or in the posting forms yet; the Terms v4 archive page says it is not in force                                                                                                                                                                                                                                                                                                 |
| 18. R69 slots (Pricing v2 P2)                | keep (owner, 2026-11-12 and 2026-11-13)                                                       | Paid slots are on sale at R69 per 30 days: the checkout offers 30, 90 or 180 days, the number of slots and the cooling-off box; a new 'My slots' page in the dashboard                                                                                                                                                                                                                                   |
| 19. One tap opens any post (M10.5)           | keep (owner, 2026-11-13, with the M10.5 part of 2 rows elsewhere)                             | Phones and tablets: one tap on a video card opens the post, like a photo card; a small 'Preview' button plays the video in place; with data saver on, nothing plays by itself                                                                                                                                                                                                                            |
| 20. Staff fix paid but not delivered (M3.4)  | keep (owner, 2026-11-13)                                                                      | Staff only: delivery status on Payments & Refunds, a 'needs attention' list, 'Activate what was paid for', refunds with Ozow's reference and a reason, one slot refunded alone, a second approver above R1 000                                                                                                                                                                                           |
| 21. Payment receipt email (M3.7) (no file rows: email only) | keep (owner, 2026-11-13)                                                                      | Members who pay: the 'Payment received' email lists the invoice number, date paid, item, amount in rands and bank reference, and links to 'My slots' (add-ons: the dashboard) instead of Billing                                                                                                                                                                                                         |
| 22. Hidden until it works, part 2 (M6.2)     | keep (owner, 2026-11-13)                                                                      | No 'Performance' page or menu entry and no 'Detect province and city' button; a search lists tourism businesses under Businesses again                                                                                                                                                                                                                                                                   |
| 23. Phone-sized photos (M4.3)                | keep (owner, 2026-11-13)                                                                      | Nothing on screen: the same photos, but a phone downloads a 400, 800 or 1 600 px copy of each new photo instead of the full-size original                                                                                                                                                                                                                                                                |
| 24. Staff record a bank transfer (P2b)       | keep (owner, 2026-11-13, with the P2b part of 4 rows elsewhere)                               | Staff only: 'Record a bank transfer' on Payments & Refunds; a second staff member confirms it before the slots start; a confirmed transfer shows its bank reference, and its refund form asks for the bank reference of the transfer back                                                                                                                                                                |
| 25. Communication choices saved (M1.7)       | keep (owner, 2026-11-13)                                                                      | Notifications page: no 'Failed to load email activity' message on every visit; the four switches (all off until turned on) stay as set after a reload; the Email tab lists the member's own sent and failed account emails                                                                                                                                                                               |
| 26. Photo allowance and search pages         | keep (awaiting owner)                                                                         | Phones get the 800 px photo copy for small images too; when the month's photo processing runs out, 'Photo uploads are paused for now. Please try again later.'; a business search with more than 480 matches counts at most 480 (450 at 50 a page) and has no page that fails                                                                                                                            |
| 27. Hidden until it works, part 3            | awaiting owner (with the group 27 part of 7 rows elsewhere)                                   | Staff: no Commercial settings, Free posts & trials, Programmes & contracts, Operations health or Intelligence pages (their addresses lead to the staff home). Members: no 'Delete account' (a line points to the data request form) and no organisation 'Performance' tab with its CSV downloads                                                                                                         |
| 28. Staff refunds through Ozow               | keep (owner, 2026-11-14, with the Ozow refund part of 2 rows elsewhere)                       | Nothing until the owner switches it on. Then staff only: on Payments & Refunds, 'Refund through Ozow' sends the refund to Ozow (no reference to type), 'Recorded in the Ozow dashboard' (admins) takes Ozow's refund id, each payment shows its Ozow refunds, and a 'Refunds that need staff' card lists failed, returned or stuck ones                                                                  |
| 29. Bank transfer and consent fixes          | approved by owner 2026-11-14 (with the review-fix part of 1 row in group 24)                  | Staff: the 'Possible duplicate' line names the same bank reference and amount; refund messages name no provider. Members: a bank transfer's receipt is dated by the day the money cleared, no receipt after a refund, and the communication page says when the session ended                                                                                                                             |
| 30. Video length and seller guidance (M4.4a) | awaiting owner (with the M4.4a part of 10 rows elsewhere)                                     | Every video field says 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'; a longer video, or one whose length cannot be read, is refused with its real length; phone originals up to 300 MB are accepted for conversion                                                                                                  |
| 31. Customer invoices with Pay now (P2b)     | approved by owner 2026-11-14 (with the invoice part of 2 rows elsewhere)                      | Members with an invoice: an 'Invoices' page and the invoice itself ('Invoice', VerifyMzansi is not registered for VAT), with their billing details, the cooling-off box, 'Pay now' (Ozow) and 'Print or save as PDF'. Staff: an 'Invoices' card on Payments & Refunds to issue, list and void invoices, and an invoice page with the customer's link and a form to record a bank transfer to the invoice |
| 32. Renew early (P3)                         | awaiting owner (with the renew-early part of 5 rows elsewhere)                                | Members: 'Renew' on each Individual slot from 14 days before it ends and 'Renew all' on My slots; the checkout renews the chosen slots, each from its own end date, with the renewal's own box; a reminder email 3 days before a slot ends with a renew link                                                                                                                                             |
| 33. Multi-listing packages (P4a)             | approved by owner 2026-11-16 (with the P4a part of 7 rows elsewhere)                          | Nothing while packages are not on sale (the owner's switch). Then: 'Choose your package' (a typed number of slots from 5 at R100 per slot per 30 days, 30, 90 or 180 days, the 'My slots start now' tick; above R10,000 by invoice), the package on My slots, the Multi-listing page's new words and prices, and a message when Individual slots or invoices are refused while a package runs            |
| 34. Erased accounts in staff payment screens (no file rows: all in groups 20, 24 and 28) | approved by owner 2026-11-16 (owner decision 7 on the erasure pull request) | Nothing today (no account has been erased); for an erased account, the staff payment screens leave its account id empty instead of failing |
| 35. Live-test fixes (17 November)            | awaiting owner (with the live-test part of 10 rows elsewhere)                                 | Dashboard: 'Three steps to your first post' ticks the verification step only once the ID is accepted ('Verification in review' keeps its number 1). Nothing else on screen: missing posts answer a real 404 with the same page, pages name their canonical address, the error page is kept out of search results, and the bell checks for news once a minute with one request                            |
| 36. Invoice choice and Ozow's maximum        | approved by owner 2026-11-17 (owner question 29)                                              | Checkout: 'Need an invoice before you pay? Get an invoice' at every amount; above Ozow's maximum (R1 300 today) the invoice only; invoices above it by bank transfer; packages above it by invoice; new Terms                                                                                                                                                                                            |
| 37. Hidden until it works, part 4            | hidden until it works (owner decision 2026-11-16)                                             | Notifications page, Preferences tab: no 'Analytics' or 'Third-party sharing' switch; the two marketing switches stay                                                                                                                                                                                                                                                                                     |
| 39. Claim a case before viewing documents    | awaiting owner (with the claim-first part of 1 row in group 3)                                | Staff only: on the ID check queue, 'View documents' and each row's 'View' are greyed out with 'Claim this case first' until the staff member holds the case's claim, instead of failing with a refusal                                                                                                                                                                                                   |
| 40. The site matches the Terms (v5)          | approved by owner 2026-11-17 (owner question 30; with the group 40 part of 14 rows elsewhere) | Advertise, Pricing, Business Sponsors, the home sponsor band and the showroom help: no Business Sponsor offer and no paid add-ons (hidden until they work); 'Can I cancel?' states the Terms' refund, cancelling and cooling-off rules; 1 to 4 Individual slots; edits 'up to 2, 6 or 12 for a 30-, 90- or 180-day slot'; the free post as the Terms describe it; 'VAT status: not registered for VAT'   |
| 41. Account events in the bell               | awaiting owner (owner question 31)                                                            | The bell lists 'Your ID check was accepted', payments, new invoices, post approved or not approved, posts shown again, post expiry and slot reminders                                                                                                                                                                                                                                                    |
| 43. A working Delete account button | approved by owner 2026-11-19 (owner question 32; its switch stays off until the staff half is built and goes on before launch; with the group 43 part of 2 rows elsewhere) | Nothing while its switch is off: the Account tab keeps the line pointing to the data request form. When the owner switches it on: 'Delete account' is back and works; its dialog says what closing does, asks for DELETE and a sign-in from the last 15 minutes (no password field); the data request line is gone |
| 44. Phone pages widened by the nav strip     | approved by owner 2026-11-19                                                                  | Phones: dialogs and toasts on member dashboard pages sit on the screen again; the section strip looks and scrolls the same                                                                                                                                                                                                                                                                               |
| 46. Opening the ID check page only reads     | awaiting owner (with the page-view part of 2 rows in groups 2 and 5)                          | Nothing visible: opening /verification only reads the saved status; it no longer starts a verification case in the background before the member does anything                                                                                                                                                                                                                                            |
| 45. Bank transfers expire after 14 days | awaiting owner (no file rows: the expiry part of 4 rows in groups 24 and 31) | Staff: an 'Expired' list ('Not confirmed within 14 days') in 'Record a bank transfer', kept until each is followed up, with 'Money returned' and 'Never arrived' buttons. Members: on an invoice whose bank transfer expired, a note that it expired and the invoice is unpaid again, with Pay now back |
| 47. Less personal data on staff and organisation screens | awaiting owner (with the group 47 part of 1 row in group 27) | Staff review queues name members 'Thandeka D.'; members are told in the bell and by email when their data request is approved and when their data is exported; the support inbox lists 12 months (older only while open); organisation dashboards show a pending applicant's contact only on 'Show contact' and co-admins by short name |
| 48. Refund follow-ups, read before the database update | awaiting owner (no file rows: the refund follow-ups part of 3 existing rows) | Nothing visible today. Staff only, once the refund follow-ups database update is live: a refund carrying the reason 'Cancelled before the renewal started' shows that label, a refund through Ozow that was too late shows 'too late for a refund through Ozow: pay it back by bank transfer and record the bank reference', and three new refusals are worded |
| 51. Refund follow-ups offered to staff | awaiting owner (no file rows: the refund follow-ups part of 5 existing rows) | Staff only: 'Cancelled before the renewal started' is offered on a renewal payment; a payment paid through Ozow says 'Ozow refund possible until <date>' (13 days after it, by this device's clock) or, after that, 'Ozow's 13 days for a refund ended <date>: pay it back by bank transfer'; 'Paid back by bank transfer' (and 'Slot paid back by bank transfer') is offered next to the Ozow refund and opens the refund form with 'Bank reference of the refund transfer' and a 'Before you pay' note (the date, and refund a waiting renewal first); the database decides which refund is possible; an approved refund that failed before reaching Ozow says 'Nothing was sent to Ozow' |
| 49. Pricing by offer | keep (redesign approved by owner 2026-11-18, variant B, picture 01) | Pricing: 'Posting slots' with one 'Every slot includes' strip and three term cards instead of the Market / Business / Tourism & Events picker; free events in their own strip; no tab row while only Individual slots are on sale |
| 52. Old multi-listing wording and a council mention | awaiting owner (no file rows: the group 52 part of 6 existing rows) | Nothing visible today (all behind switches that are off). When shown: the multi-listing box in the posting flow and on billing states the package rules on sale (5 to 250 posts, 30, 90 or 180 days, R100 per slot per 30 days); no 'Founding pilots' box on Advertise; the empty Business Sponsors box names no council or place |
| 53. Package invoices and 'Ask for an invoice' (P4e) | awaiting owner (with the P4e part of 3 rows elsewhere) | Nothing while packages are not on sale (the owner's switch). Then: on 'Choose your package' above Ozow's maximum, a tick and an 'Ask for an invoice' button send the request to staff (no email); staff only: a 'Package invoice requests' card on Payments & Refunds to issue, prepare (above R50 000, approved by a second admin) or decline; the invoice then appears under the member's Invoices as today |
| 54. Privacy tightening 2: short names, search depth, partner rate | awaiting owner (with the group 54 part of 6 rows elsewhere) | Search and browsing: page links stop at page 100, and the last page says 'Showing the first N results. Narrow your search to see more.' when there are more; staff only: restricted members, partners and organisation administrators named 'Thandeka D.', partner rates up to 20%, and applicant contacts on the staff organisation page only for pending applications behind 'Show contact' |
| 55. Pricing: 'Editing your post' heading | approved by owner 2026-11-19 (no file rows: the group 55 part of 1 existing row) | Pricing: the box with the approved-edits rule is headed 'Editing your post' (was 'How your package works') |
| 56. Loading screen named for screen readers | approved by owner 2026-11-19 | Nothing visible; screen readers hear one 'Loading' status on the placeholder shown while a page loads |
| 57. Removed for launch: old staff tools, trial tools, data-use choices, province chip | awaiting owner (removal approved by owner 2026-11-19; with the group 57 part of 17 rows elsewhere) | Staff: the Commercial settings, Free posts & trials, Programmes & contracts and six Intelligence pages answer 'Page not found'. Members: nothing visible changes apart from 'Optional messages.' on the Preferences card; the showroom help page loses 'Local first, never local only' and its 'How we know your province' section, and the privacy notice its 'Showroom location' paragraph |
| 58. 'Detect province and city' shown at launch | awaiting owner (no file rows: the group 58 part of 1 existing row in group 2) | Nothing before launch (its switch stays off). At launch: the verification location step offers 'Detect province and city' again, as in the chosen version; it fills in a suggested province and city, or says to pick them from the list |
| 59. Video seek bar and time (roadmap M10.7, first part) | approved by owner 2026-11-20 (with the group 59 part of 6 rows elsewhere) | Every video player: the seek bar can be grabbed anywhere in a 24 px tall strip, follows a sideways drag on phones and jumps on a tap, while an up or down swipe still scrolls the page; arrow keys move 5 seconds; the time label shows the real length (it read '0:04 / 0:00' when the video loaded early). Video mode on phones: a new thin gold seek bar with '0:12 / 0:45' under the post's buttons. Posting and edit forms: the video help text adds one tip to show price, place and phone number on screen |
| 60. Multi-listing packages: the small part-one gaps (Pricing v2 P4a) | approved by owner 2026-11-19 (with the group 60 part of 7 rows elsewhere) | Members (only once packages are on sale): 'Your package is active' after paying for a package (draft n1), and a note on 'Choose your package' about unpaid Individual slot invoices. Staff: a 'Needs attention' card on Payments & Refunds while a package move keeps failing (part of draft n7) |
| 61. Real view counts and likes (P6) | awaiting owner (with the group 61 part of 11 rows elsewhere) | Nothing today (switch off). When the owner switches SHOW_ENGAGEMENT_TOTALS on: 'N views' and the heart with its count are back as on 27 October, with real numbers; anyone can like (signed in, per account; signed out, per browser; tap again to unlike); a signed-out visitor's first counted view or like may show Cloudflare's 'Verify you are human' box bottom-right, only when Cloudflare needs a click; a signed-out like from a browser seen for the first time counts after 10 minutes (the visitor sees it at once); a view counts after 2 seconds on the post's page, once a day per visitor, never the owner's or staff's own; the privacy notice and PAIA manual describe what is stored |
| 62. Add slots part-way through a package (Pricing v2 P4b) | awaiting owner (with the group 62 part of 8 rows elsewhere) | Nothing today (packages are not on sale). Once they are: 'Add slots' on the package card of My slots while 7 or more days are left; the 'Add slots' page (approved drafts p4-03 and p4-04; the invoice variant, draft n2, new); 'Slots added' after paying; staff see added-slots invoice requests in the existing queue |
| 63. Sign-up mode in the database (item 7) | approved by owner 2026-11-20 (no file rows: the group 63 part of 2 rows in group 2) | Nothing while sign-up is by invitation (today). Once the owner opens sign-up: a Google sign-up refused for a blocked or reserved email domain shows 'This email can't be used to register' on the sign-in page, and the profile page's email change refuses such an address with 'This email address can't be used. Use a different address.' |
| 64. Toasts clear of form buttons on phones | approved by owner 2026-11-20 (with the group 64 part of 1 row elsewhere) | Phones (narrower than 768 px): a toast shows at the top of the screen instead of near the bottom, where it covered the button tapped next ('Verify', 'Update password'); while it shows (about 5 seconds) it covers the header (logo, search, menu). Tablets and desktops: same place and look (bottom right). Every screen size: a tap on the empty space around a toast now reaches the page |
| 65. Member invitations (staff) | approved by owner 2026-11-20 (design and pictures; with the group 65 part of 1 row in group 57) | Admins only: a 'Member invitations' page under Platform in the staff menu. An admin types an email and presses Invite; the page says nobody is emailed and gives the sign-up link to copy and send. Each invitation shows Waiting to join, Joined, Withdrawn or Expired with one date; waiting ones can be withdrawn after a confirmation. An address that already has an account, today's limit of 200 and non-admins are refused with a plain message. It never gives staff access |
| 66. One main button per screen (button hierarchy) | approved by owner 2026-11-20 (with the group 66 part of rows in other groups) | Every page: one filled main button per screen. Header 'Register' and '+ Post' light-green tinted; Pricing's three terms equal and outlined, no footer band; gold main buttons on dark-green bands (footer band, Advertise, the two verification help heroes, Trust & Safety); black buttons outlined; section pages' title buttons outlined; post page 'WhatsApp' outlined; dashboard, checkout and My slots: the ID review button is the main one until it is done; Terms and Privacy e-mail addresses are text links; Safety Centre's second 'Report a problem' a text link. Follow-ups: Home's About 'Post for free' outlined (the footer band's gold one is Home's main button); Safety Centre hero 'Report a problem' gold; My posts' 'New post' on every tab, filled when there are posts and outlined only beside the empty list's 'Create your first post'. No black (owner: no black, light tourism colour): selected chips and tabs and the former black buttons are light teal |
| 67. Daily limit on SMS codes: message (no file rows: server message only) | approved by owner 2026-11-20 | 'Verify your phone number' and 'Complete your profile': when the site's daily limit on SMS codes is reached, 'Send code' shows 'We can't send codes right now. Please try again later.' under the number instead of sending a code (until midnight, South African time). Nothing changes otherwise |
| 68. Old backend retired, part 2 (item 10) | approved by owner 2026-11-20 (with the group 68 part of 7 rows elsewhere) | Create a post: a verified member no longer sees 'Verification required before posting' flash up, and a member under review or turned down sees the right note at once. Nothing else on screen: post pages, Leads, Pricing and Billing look the same, and the post pages read no session |
| 69. ID photos with the camera only, Continue on your phone, names as on the ID | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) (with the group 69 parts of 3 rows elsewhere) | Get verified: the ID name fields read 'All first names (as on your ID)' and 'Surname (as on your ID)' with a hint; ID and selfie photos are taken only with the camera on the page (no 'Or upload a photo'); the ID camera shows live hints and a light button, then 'Check your photo' with Retake / Use this photo; camera problems show per-browser steps; on a computer without a camera, 'Continue on your phone' shows a QR code and the phone page takes the photos; the privacy panel adds 'ID photo deleted after 1 month'; help is camera-only |
| 70. Staff operations health (item 8) | approved by owner 2026-11-21 (with the group 70 part of 1 row in group 27) | Nothing today: the staff 'Operations health' page stays off until launch (item 60). Once on: tiles for stuck emails, stuck notices, payment problems and blocked deletions; a 'Scheduled jobs' table with each job's last run and 'On time' or 'Late'; cards listing what is stuck; 'Evidence retention' and 'Open incidents' kept; no 'Retry job' button |
| 71. Invite-only sign-up: clearer, kinder message (item 11) | approved by owner 2026-11-21 (with the group 71 part of 3 rows elsewhere) | Sign-up while it is by invitation (today). After 'Create account' the page goes straight to sign-in, whose 'Check your email' box says: 'VerifyMzansi is open by invitation for now. If this email was invited, we've sent it a confirmation link. Nothing there after a few minutes? Resend it, or sign up with the email address your invitation was sent to.' (was 'Registration is by invitation only for now...', also repeated in a green message after 'Create account'; that message is gone, so the words show once). A Google sign-up without an invitation: 'Sign-up is by invitation for now' and 'If you were invited, use the email address the invitation was sent to. Already have an account? Sign in with the email you used.' in the plain (white) message style instead of the red error style (was 'Registration is not open yet'). Every address still gets the same answer, so the page never says who is invited. |
| 72. Staff: an expired authenticator check on an action goes to the two-step page | approved by owner 2026-11-21 (with the group 72 part of 1 row elsewhere) | Staff only: when a staff action (a button or form on a staff page) is refused because the authenticator check has run out, the page now goes to 'Two-step verification' (or 'Confirm it's you') and comes back to the same page afterwards, as opening a staff page already does. Before, many staff screens showed the refusal as an error. Member invitations: a malformed request no longer blames the email address. Nothing changes for members. |
| 73. Create a post: the verification read checks the account (no file rows of its own) | approved by owner 2026-11-21 (the group 73 part of 2 rows elsewhere) | Nothing on screen. The verification status read on 'Create a post' now also checks that the decision it reads belongs to the signed-in account; if it does not, the page shows 'Finish verification to start posting.' and the browser asks again, as for any other failed read. |
| 74. Old backend retired: last unowned reads (no file rows: the group 74 part of 6 rows elsewhere) | approved by owner 2026-11-21 | Nothing. My profile and the enquiry form read the same data through named live-backend reads; an unused verification hook is deleted. Before and after pictures are identical. |
| 75. Old backend retired: Complete profile read (item 10) (no file rows: the group 75 part of 2 rows elsewhere) | approved by owner 2026-11-21 | Nothing (pixel-identical, no visible change). 'Verify your phone number' reads the same profile through the named live-backend read; before and after pictures match pixel for pixel. |
| 76. Limits register: size limits tested at their bound (and the group 76 part of 3 rows elsewhere) | keep | Nothing; tests only |
| 77. Authority requests (staff) | approved by owner 2026-11-21 | Governors and admins only: a new Authority requests page (Compliance menu) to open a member's kept identity record for a police or court request, with the request form, the logged record page and a watermarked print disclosure sheet. Members see nothing new. |
| 78. Staff privacy requests: no Export on completed requests (no file rows: the group 78 part of 2 rows elsewhere) | approved by owner 2026-11-21 | Staff only: on a completed access request the Export JSON button is greyed out instead of clickable and always refused. A completed request can no longer be exported; staff open a new request. |
| 79. Sales and VAT for staff (item 16) | approved by owner 2026-11-21 (with the group 79 part of 4 rows elsewhere) | Staff only: a 'Sales and VAT' card at the top of Payments & Refunds (sales of the last 12 months less refunds, VAT status, online checkout drop-off over 30 days, sales by product and term) and a red VAT alert from R1.8 million. Visitors: nothing changes today; the 'VAT status' line on Pricing, Billing and Trust & Safety now comes from the database setting and is left out if it cannot be read. |
| 80. Partner page (item 48) | approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved (with the group 80 part of 1 row in group 4) | Nothing today (switch off; SHOW_PARTNER_PAGE stays off at launch too, until the partner agreement is signed). Once on, a partner's page shows: the green band with 'Earned this month' (with 'Includes commission still in its 30-day wait.') and 'Next payout'; 'Share' with the link, code, 'Share on WhatsApp' and 'Download QR code' (a PNG picture); 'Progress' (Signed up, Paying); 'Money' (Pending, Approved, Paid); 'Help' (Partner rules, Contact us); then today's 'Recent commission' list. No customer names (the Terms say a partner never sees them); no statements or booklet yet (they wait for item 50 and the partner agreement). Someone who is not a partner sees today's page either way. |
| 81. Performance page: real figures from the live backend (item 2) (and the group 81 part of 2 rows elsewhere) | approved by owner 2026-11-21 | Nothing today: the Performance page and the staff Operations health page stay off until launch. Once on: the Performance page looks as on 27 October with every section filled from the live backend; the staff 'Scheduled jobs' table lists an 18th job, 'Old view records removed'. |
| 82. Automatic ID checks: hidden until it works (no file rows) | hidden until it works (approved by owner 2026-11-21) | Nothing. The database part of automatic ID checks (update 20261121094003) is in, with the switch at Manual; members keep the in-page camera and staff review. The database keeps the switch at Manual until the retention update (C1) is applied |
| 85. Business storefront (item 17b, first part) | approved by owner 2026-11-21 (with the group 85 part of 7 rows elsewhere) | Nothing today (switch off). Once on: a checked business with a running Multi-listing package and at least one live listing shows 'All stock' (search, filters that follow the trade, newest first, Show more) on its business page, and each of its listings names the business (logo or initials) with 'See all 18 cars'. |
| 86. Copy a post (item 17b, second part) | approved by owner 2026-11-22 (with the group 86 part of 8 rows elsewhere) | Nothing today (switch off). Once on: a member whose Multi-listing package runs gets 'More', then 'Copy this post' on My posts; the copy opens in the 'Post an item' form with a note (everything but the video filled in, one new photo for vehicles and property), unfinished copies wait under 'Drafts' for 14 days, and reviewers see 'Copied from'. |
| 87. Post templates (item 17b, third part) | approved by owner 2026-11-22 (with the group 87 part of 6 rows elsewhere) | For a member whose Multi-listing package runs: 'Save as template' on the Edit listing form (a naming dialog listing what a template keeps and leaves out), and 'Start from a template' on Create Post once a template exists, whose Use opens the 'Post an item' form filled in; each template's menu has Rename and Delete. |
| 88. Fair showroom for every post (item 66) | awaiting owner (design and plan pictures approved by owner 2026-11-21: 'Approve all 7'; built pictures awaiting; with the group 88 part of 6 rows elsewhere) | Showrooms (home and each area) show posts in fair turns, mixing the visitor's city, province and the rest of South Africa (3 / 2 / 2 of every 7 places), with a gold 'New' tag for a post's first 3 days live; help page, Performance card (hidden) and privacy notice wording to match. |
| 89. Authority requests: only the four D9 request types (item 69) (no file rows: the group 89 part of 6 rows in group 77) | approved by owner 2026-11-22 | Governors and admins only: the authority request form offers only a subpoena, court order, search warrant or urgent life-risk request, and asks for the issuing court (or SAPS station), the official number called and who confirmed it; the record and print sheet show the request type, reference, issuer and check; an urgent request shows no selfie or ID photo. Members see nothing new. |
| 90. Hide nothing before launch: every feature switch on (item 71) (no file rows of its own: the group 90 part of 21 rows elsewhere) | approved by owner 2026-11-22 (answer: 'Approve pictures') | Every built page and section that was hidden behind a compile-time switch is shown: view counts and likes, the Performance page, 'Detect province and city', staff Operations health, 'Delete account', paid add-ons, the Business Sponsor offer, Multi-listing packages on Pricing and Advertise (the Multi-listing page and package checkout always open; buying waits for the database switch), the redesigned partner page (no commission rate or waiting period in numbers), the business storefront and 'Copy this post'. The organisation report and package teams stay hidden (not built). The pre-launch pop-up stays until sign-up opens |
| 91. Email before a long paid term ends (item 68b) (no file rows: email only) | awaiting owner | Members with a paid slot or package of 180 days or more get one email about 12 weeks before it ends: the end date, that nothing renews and nothing more is charged, and how to buy again (My slots for an Individual slot, otherwise Billing; an Individual slot whose post moves into the member's running Multi-listing package is told only that; a banned or suspended member is told only that nothing more is needed). Nothing changes on any page. |
| 92. Registered street address no longer shown (no file rows: data setting only) | approved by owner 2026-11-22 | Trust & Safety (and the Terms and PAIA pages, which list the same company details) no longer show a 'Registered address' row with the street address. The other company details (registered name, trading name, CIPC number, officers, contacts) are unchanged. |
| 93. Free credits for businesses you recruit (item 70) | awaiting owner (with the group 93 part of 4 rows elsewhere) | Admins only: a 'Free credits' page under Commercial in the staff menu to give an ID-verified member 1 to 6 free posts for 1 to 30 days with a reason, list every gift (masked email, posts, end date, Active or Ended, views) and extend one by 1 to 30 days. Members with a gift: 'Free credits from VerifyMzansi: 1 post' with its end date on My slots, and 'Free credits from VerifyMzansi' on the posting slots card of My posts. |
| 94. Email before a free credit ends (item 70b) (no file rows: email only) | approved by owner 2026-11-23 (answer: 'Yes, approve both'), with 'cover' in place of 'pay for' | Members with free credits from VerifyMzansi get one email 3 days before they end: the end date, that the posts they cover are then hidden and, unless reactivated in another slot, deleted 3 days later with their photos and videos, and a 'See my slots' button. A gift extended after the email gets a new one 3 days before its new end; nothing is sent for a gift ended early or to a banned, suspended or closed account. Nothing changes on any page. |
| 95. Terms posting-v6: the package rules (item 27) (and the group 95 part of 8 rows elsewhere) | approved by owner 2026-11-24 (answer: 'Yes, approve both') | The Terms page gains a section 'Multi-listing packages' and changed paragraphs on prices, paying, refunds, the free post, prohibited content and the content licence. The page's own 'Reporting a post' section (group 96) is removed: the same rules are in the Terms text under 'Prohibited content'. After the switch, the three edit forms show the posting-terms tick until the member accepts the new terms. Members tick the posting terms again before their next post or edit (the same tick as today). |
| 96. Legal must-haves before sales open (item 68) (and the group 96 part of 9 rows elsewhere) | approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'), with the owner's name shown once and legal notices to legal@ | Terms: company details (status, director and Information Officer in one row, phone, email, website, dispute code), a 'Reporting a post' section and how to keep a copy. Contact: a 'Complaints' card. PAIA manual: contact details, abbreviations and updates sections. Checkouts: 'Terms · Refunds'. Invoice: 'Total before VAT' and 'VAT None'. No page prints a street address (the 'Registered address' row is removed from Terms, PAIA and Trust & Safety). |
| 97. Test fix: no delayed redirect after My profile unmounts (item 76) (no file rows: the group 97 part of 2 rows elsewhere) | awaiting owner | Nothing; tests only. The page and its redirect after closing an account look and behave the same. |
| 98. Remove paid add-ons (item 37) (and the group 98 part of 10 rows elsewhere) | approved by owner 2026-11-25 (answer: 'Approve them') | Advertise, plan cards, billing FAQ, showroom help and My posts no longer mention or offer Urgent, Boost or Featured; the add-on buttons on My posts and the 'Boost level' column in the business 'Post' dialog are gone. |
| 99. Automatic ID checks: member and staff screens (item 61, part 7) (with the group 99 part of 5 rows elsewhere) | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures); plan pictures approved 2026-11-20; consent wording per decision L | Nothing while the staff setting is Manual (today's value, and it stays Manual until the consent record is in the database). On a Didit setting, Get verified's ID step shows the independent check: names, what it asks, a consent tick naming Didit with links to its two notices, Start ID check, the check inside the page, then Checking, Verified, 'A person will check your ID' or a decline with 'Try the ID check again' and 'Ask a person to look again'. Staff: an 'ID checks' card on Verify accounts (three settings, admins change it) and a Didit panel in the case view. |
| 101. Trust promise matches reality (item 41) (no file rows of its own: the group 101 part of 12 rows elsewhere) | approved by owner 2026-11-25 (answer: 'Approve them') | Privacy Policy: a 'Who we are' section, a 'Cookies and browser storage' section, the keep-for periods the system applies, every provider and country named, and no claims of screen replays or logged number taps. PAIA names the same recipients. Trust & Safety, Advertise and the business verification help no longer say only 'our team' reviews IDs. The posting plan box loses 30-day free-post branches that could never show. Home, the footer and the site description say 'businesses, products, services, tourism and events from ID-reviewed posters' instead of 'verified businesses, products, ...'. Get verified (independent check): the privacy panel's keep-for line follows the applied rules and the consent names Ireland (European Union) and the United States. |
| 100. Add lost days (item 75) (and the group 100 part of 1 row elsewhere) | approved by owner 2026-11-25 (answer: 'Approve both', for the v2 pictures and the database update) | Admins only, on Payments & refunds: an 'Add lost days' card. Staff enter a member's email, check their running paid slots and package (each with its end date), choose 1 to 30 days and a reason, and see each new end date before and after adding. Every running paid slot and package of the member gets the days; a queued renewal moves with its slot and a package's slots still end together. At most 30 days in all per slot; beyond that, or for an ended slot, staff refund instead. Members see only their later end dates; nobody is emailed. |
| 102. Lost-email alert and staff deadline emails (item 28) (no file rows: email only) | approved by owner 2026-11-25 (answer: 'Approve with the fix', for the three email pictures, with '1 more is not listed' fixed) | Nothing for members or visitors. Staff with the role that handles them get one email about each new privacy request, appeal and report (up to 30 a day for all staff, never to the person a report is about): its type, a reference, when it came in and its deadline, with a button to the staff page. The support address gets one email listing queued emails that failed their last attempt, at most one every 15 minutes. |
| 104. Staff refunds: first purchase and part refunds (item 77) (and the group 104 part of 5 rows elsewhere) | approved by owner 2026-11-25 (answer: 'Approve them') | Admins only, in the refund forms on Payments & refunds: an amount to refund (part of what is left) and, for an account's first purchase, the reason 'First purchase cancelled (within 5 business days)' with the date the customer asked. The form says whether the slot ends now or keeps running. Whole refunds and chargebacks look and work as before. |
| 103. Showroom video posts show their chosen frame and logo (no file rows: data only, `src/lib/showroom/feed.ts`) | approved by owner 2026-11-25 (answer: 'Approve them', for the before and after pictures) | Home and area showrooms: a video post's card plays its video over the frame the owner chose, and a post with a logo shows it in the card, as in the chosen version; before, a video-only post showed the generic shop artwork with no video and the title's first letter instead of a logo. Posts with neither look as they do today. |
| 105. Small lifecycle rules (item 40) (and the group 105 part of 1 row elsewhere) | approved by owner 2026-11-25 (answer: 'Approve with the rewording', the pictures with the sticker email reworded) | Owners of a post with an open report see that it can be hidden now and deleted once staff have looked at the report. Business owners get one email 30 days before a CIPC registered or Seen sticker ends, linking to the business's verification page, and the Seen step there offers the booking form from 60 days before the sticker ends. Free events cannot start more than 12 months ahead (the form already said so). |
| 106. Removing an admin needs approval; appeal pages off the old backend (item 20, part 1) (and the group 106 part of 1 row elsewhere) | approved by owner 2026-11-25 (answer: 'Approve them') | Nothing for members or visitors. Admins: removing another admin now waits for a different admin's approval on Staff roles, and its header line says so. |
| 107. Change a verified phone number or place (item 20, part 2) (no file rows of its own: the group 107 part of 4 rows elsewhere) | approved by owner 2026-11-25 (answer: 'Approve them') | Members: 'Change number' on My profile opens the phone step to verify a new number by SMS code (at most every 15 days, after the ID review); province and city can be changed on My profile at most every 15 days. |
| 111. Showroom cards with a video and photos show the chosen frame (item 56) (no file rows: data only, `src/lib/showroom/feed.ts`) | approved by owner 2026-11-26 (answer: 'Yes to everything', for the before and after pictures) | Home and area showrooms: a post with both a video and photos plays its video over the frame the owner chose, as on the 27 October cards; before, it showed the first photo there. With no chosen frame it keeps the first photo. Posts without a video look as they do today. |
| 108. Staff told to end an admin role before restricting that person (item 20, part 3) (no file rows: wording outside the checked scope) | approved by owner 2026-11-25 (answer: 'Approve it') | Staff only: on Reports (Ban, Suspend, emergency containment) and Governance (Approve), an action against a person who holds an admin role is refused with 'End this person's admin role first. Another admin must approve that, then try again.' |
| 109. Staff refund follow-ups (item 56, batch A) (no file rows of its own: the group 109 part of 8 rows elsewhere) | approved by owner 2026-11-26 (answer: 'Yes to everything') | Members: the 'Payment update' email now reads 'A refund or reversal of a payment has been recorded. Review the current details in Billing.' (was 'A payment reversal has been recorded. …'), also right for a part refund that keeps the slot running. Staff on Payments & refunds: the section 14 hint counts paid days from the end of the 20 business days' notice, without free lost days; the refund forms say when lost days were already added, and Add lost days says when money was already refunded for a failure (warnings only); a chargeback says how much was already returned; a refund form opened again after a lost answer sends the same request, so nothing is refunded twice. |
| 117. Invoice payment link and invoice email (items 34 and 38) (and the group 117 part of 5 rows elsewhere) | approved by owner 2026-11-26 | Customers: a staff invoice is emailed ('Invoice VM-… from VerifyMzansi') with 'View and pay invoice'; the link opens a new page with the invoice and the same pay panel, without signing in; after Ozow, 'Thank you' or 'Payment not completed'; a link that does not work says so. The receipt of an invoice payment adds 'Invoice paid: VM-…'. |
| 110. Release one blocked phone number (item 21) (and the group 110 part of 1 row elsewhere) | approved by owner 2026-11-26 (answer: 'Yes to everything') | Nothing for members or visitors. Admins and governors, on Restrictions: a 'Blocked phone numbers' card to ask to free one number a ban blocks (number and reason), the waiting requests (a different staff member approves or rejects; the person who asked can withdraw) and the latest releases. The person's ID ban stays. |
| 112. Lifecycle rule follow-ups (item 56, batch D) | approved by owner 2026-11-26 (answer: 'Yes to both') (no file rows: the group 112 part of 2 existing rows; text outside the checked scope in `src/lib/foundation/restored-post-route.ts`) | Business verification page: dates are shown in South African time, so an owner abroad sees the same 'renew by' date as the reminder email (no change in South Africa). Saving a free event that starts more than 12 months ahead says 'Events can start at most 12 months ahead.' instead of the general message (the form already blocks this). On My posts, while a report from the public is open, the owner can delete the post only once the report is 7 days old and the post's clean-up waiting time has passed; a staff duplicate flag no longer stops it; the message is unchanged. |
| 119. Catalogue filters run in the database (item 29) | awaiting owner (no file rows: the group 119 part of 1 existing row; data only in `src/lib/foundation/marketplace-read.ts`, `feed-read.ts` and `post-search.ts`) | No layout change. An organisation's 'Supported businesses' list, Mzansi Business with an organisation filter, a Business text search and Video mode load each list in one database read. Behaviour at more than 480 results: a Business text search pages on to 100 pages, as every other search does, instead of stopping after 480 results. |
| 113. Video length checked by the database (item 39) (no file rows of its own: the group 113 part of 2 rows elsewhere) | approved by owner 2026-11-26 | Nothing for members or visitors, except a clear message when a post's video is too long for it (events: 1 minute, other posts: 2 minutes). Staff: the review panel shows each video's length and the limit. |
| 120. Post viewer: one message for an empty section (item 81) | approved by owner 2026-11-26 | Post viewer, after switching to a section with no posts (for example Mzansi Business while it has none): only 'Nothing here yet' shows; the 'You’re all caught up' end card no longer shows on top of it, and the up and down arrows are hidden there (they did nothing and covered the message on phones). Sections with posts still end with the end card. |
| 951. Keep-for periods: payment records 7 years (item 51) (no file rows of its own: the group 951 part of 2 rows elsewhere) | approved by owner 2026-11-26 | Privacy Policy: payment records are kept for 7 years after the end of the tax year (was 5), as company and tax law require; the record of a data-rights request is kept for 3 years (was 5); contact-form messages are deleted 12 months after they are resolved (new). Delete account dialog: payment records and invoices are kept for 7 years (was 5). |
| 116. Media copy URLs only for uploaded photo keys (item 78) (no file rows of its own: the group 116 part of 2 rows elsewhere) | approved by owner 2026-11-26 | Nothing. Photos and video posters use the same URLs as before; only addresses of the retired backend's file-extension keys, which no current post has, are no longer rewritten. |
| 115. Test and plumbing leftovers before public opening (item 56, batch E) (and the group 115 part of 12 rows elsewhere) | approved by owner 2026-11-26 | Nothing visible. Edit forms accept the posting terms before uploading; Create business and Create tourism share the posting-terms tick; Create listing starts fresh when the copy changes; leaving My profile right after closing the account still loads the next page in full. |
| 114. Website leftovers before public opening: wording and screens (item 56, batch E) (and the group 114 part of 18 rows elsewhere) | approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | Checkouts say 'No VAT is charged.'; Choose your package says when prices could not load; the Delete account dialog names the package (its payment records line stays at 5 years until item 51); Advertise 'Can I cancel?' adds the first-purchase refund, how refunds are paid and the package; Resubmit links to Edit when the posting terms must be accepted; a clearer message when accepting the terms fails for the connection; My posts loading no longer draws the removed Promote pill. |
| 125. Posting forms: service areas saved; errors name the right step and field (item 84 part B) (no file rows of its own: the group 125 part of 7 rows elsewhere) | awaiting owner | Create and edit business: service areas typed for a business that travels to customers are saved (create was refused before). Every posting form's error banner names the step that shows the field, the field's label and plain words, for example 'Property type: Choose one of the options.' instead of 'Attributes.property Type: Invalid option…'. |

Questions for the owner:

1. **The phone filter button (group 1).** After the restore, Mzansi Market,
   Mzansi Business and Tourism & Events show a round Filters button at the
   bottom centre of the phone screen, and tablets have no filter at all. The
   chosen version had a Filters tab on the right edge on phones and tablets. Was
   the round button your choice? Answered: it was not, and the tab is put back.
2. **Member and public wording (group 2).** Did you approve these changes made
   after 27 October? Each row says what visitors see differently. Answered: all
   are kept.
3. **Groups 3 to 5** change nothing visitors see. They can be approved as a
   whole.
4. **Hidden until it works (group 6).** Every post showed '0 views', the like
   button undid itself, and the showroom chip said 'Showing <province> first'
   although the live site ignores the province. These are hidden in place until
   the new backend supports them (your decision OD-07: hide now, rebuild after
   launch). Do you approve hiding them? Three rows moved here from groups 2 and
   4; your earlier approval of their other changes still stands. Answered:
   approved on 2026-11-10; the 13 showroom pictures were renewed.
5. **The dashboard trial card (group 2, M2.3).** With the new backend the card
   shows the member's free week again, in its existing places: 'In review. The
   trial starts when approved.' while the first post waits, then 'Visible until
   <date>'. The 'Renew using my paid plan' button and the card before the first
   post stay hidden until they work. Keep? (No file changes for this: the
   posting form's plan step now shows its '30-day free launch trial' option
   disabled, because the database offers the 7-day free week only; its wording
   is decided in M2.4.) Answered: kept (owner, 2026-11-10), together with both
   trial email wordings and the staff refusal message.
6. **The reference on error pages (group 7, M5.1).** Error pages already show a
   short 'Error reference' for support. It now shows Cloudflare's request number
   (for example `8f1a2b3c4d5e6f70-JNB`) when the error happened while the page
   was first loading, before any in-page navigation, refresh or form action, so
   support finds the exact failed request; otherwise the old code. Same place,
   label and style. Keep? Three error pages (dashboard, data requests, posting)
   show no reference today and are left unchanged. Answered: approved by the
   owner on 2026-11-12.

7. **Video posts on cards (group 8, M4.1).** With the new backend, a post's
   video was drawn as a photo on cards and in the showroom, and a generic
   picture appeared instead. Cards and the showroom's front card now show the
   existing video tile (poster and play button) again, and the showroom waits
   for a video to end before moving on, as the chosen version did. Five rows in
   groups 4 and 6 carry the same change. Keep? Answered: approved by the owner
   on 2026-11-12.

8. **Lighter pages on phones (group 9, M9.4).** The loading shimmer and the flag
   stripe's light sweep now move on the phone's graphics card instead of
   repainting the page on every frame. The colours, band, path, speed and timing
   are the same, so they should look identical (owner rule 4 asks you to
   confirm). Everything else in this group changes nothing on screen. Keep?
   Answered: approved by the owner on 2026-11-12, who also confirmed that the
   shimmer and the flag stripe's sweep look the same.

9. **Keyboard and small fixes (group 10, M10.1).** Five small repairs for
   keyboard and screen-reader visitors. Two change pictures and need your look:
   - **The selected Events tab** on Tourism & Events keeps its amber fill but
     its label turns from white to dark brown (`amber-950`, as the dark theme
     already shows it): contrast 2.15:1 before, 6.97:1 after (4.70:1 while the
     mouse is over it). Only the selected Events tab changes.
   - **A round pause button** in the bottom-right corner of the showroom, in the
     same glass style as the arrows, on screens with a mouse where the showroom
     moves by itself. Pressed, it turns into a play button and the showroom
     stops until it is pressed again. In a desktop window narrower than 768 px
     it overlaps the corner of the card's white details strip. Phones, tablets
     without a mouse and visitors who asked for reduced motion see no button,
     because the showroom never moves by itself for them.
   - Wording and behaviour, no restyle: Tourism & Events with nothing posted and
     no filter says 'No stays or events yet' (Tourism tab 'No stays or places
     yet', Events tab 'No events yet') with 'Be the first ID-reviewed host to
     list on Tourism & Events.' and only the list button; the error page shows
     signed-out visitors only 'Go to homepage'; closing the enquiry, message and
     report dialogs puts keyboard focus back on the button that opened them;
     posting forms scroll a field reached with Tab above the Back/Next bar; the
     showroom stops reading out every automatic move. Keep?

   Answered: approved by the owner on 2026-11-12, including the pause button's
   overlap with the details strip in desktop windows narrower than 768 px.

10. **Consistent details (group 11, M10.2).** Three small changes inside the
    existing look, plus the design document brought in line with your answers
    (OD-05: show first, explain below; the phone tab bar is Home · Video · Post
    · Get verified · Account):
    - **One price format.** Post pages wrote 'R 1 450.00' where cards wrote 'R1
      450'; the showroom and the home rail wrote 'R 1 450'. Every place now
      writes the card's 'R1 450' ('R12 499.50' when there are cents), from one
      shared helper. A free item now says 'Free' on its card and post page (the
      post page said 'Price on request'); 'Negotiable' never shows with Free or
      a job's salary, as your price rules say. Items priced on request still
      show no price line on cards; should cards say 'Price on request' too?
    - **No letter-spaced capitals.** Small labels such as 'QUICK FACTS', 'WHY
      VERIFYMZANSI', 'POPULAR', 'DISCOVER · CONNECT' and the event card's date
      ('WED 11 NOV') are written in sentence case with normal letter spacing; 10
      px labels become 12 px so they stay readable. The logo's 'Trusted
      marketplace' line is part of the logo and is unchanged. Staff screens,
      emails and the share picture are not part of this change.
    - **The logo at 320 px.** On signed-out phones narrower than 375 px the
      theme button sat on the 'Mzansi' wordmark. There it now moves into the
      menu ('Dark theme' / 'Light theme', last item); everything else in the
      header stays.

    Keep? The approved screenshots of the home page and the sign-in and register
    pages change with the capitals (listed in the pull request).

    Answered: approved by the owner on 2026-11-12, with the changed pictures.
    The sub-questions keep the current behaviour: cards stay without a price
    line for items priced on request, and the theme switch stays in the menu for
    signed-out visitors below 375 px.

11. **Content-first home (group 12, M10.3).** Your decisions OD-05 and OD-15,
    inside the existing look:
    - **No pop-up.** The dark 'We're launching soon' pop-up no longer covers the
      first page a visitor opens. It held no consent or legal notice, only the
      early-preview message, so nothing else replaces it.
    - **One slim line under the showroom** on the home page: 'Every poster
      ID-reviewed · What we check', in the small rounded pill the hidden
      province chip used, linking to the business verification help page (as the
      footer's 'What we check' does). Should area pages get the same line?
    - **'Be the first' cards.** An area with no posts no longer shows its rail
      heading, 'View all' and a 'No ... yet' box; one slim card in the area's
      colour says 'Be the first to sell on Mzansi Market', 'Be the first to add
      a business' or 'Be the first to list a stay or event' and opens that
      area's posting form. While sign-up is by invitation only, an uninvited
      visitor who taps it reaches the sign-in page; should it open somewhere
      else until sign-up opens? The exact words are yours.

    Keep? The approved screenshots of the home page change (listed in the pull
    request).

    Answered: approved by the owner on 2026-11-12, with the changed pictures.
    The sub-questions keep the current behaviour: the identity line is on the
    home page only, and the 'be the first' cards open the posting forms (sign-in
    first while sign-up is by invitation only).

12. **The first phone screen (group 14, M10.6).** You approved the showroom
    card's strip on the post page's main photo (OD-05). On phones (narrower than
    768 px) the market, business and event pages now show it:
    - **Market and event posts:** the card's caption at the bottom of the main
      photo: the price ('R1 450 · Negotiable', 'Free', 'Price on request', or
      the cheapest ticket, 'From R20'), the title (two lines at most, as on the
      card) and the pin with the town, white on dark shading. An event's logo
      moves into the caption's right end, as on the card.
    - **Businesses:** the name block already on the photo gains the pin and
      town, with darker shading behind it, and also shows over a profile video.
    - **Over a video** the caption sits just above the play controls and fades
      while the video plays, like the showroom card's.
    - **Short phones:** on screens shorter than about 770 px (for example 375
      x 667) the bottom of the photo was under the 'Contact seller' bar, so the
      photo frame now ends above it. Phone photos (3:4) keep their size; only
      very tall pictures get a little narrower. Taller phones see no change in
      the frame.
    - The heading and price further down stay: on phones they are below the
      first screen, so nothing shows twice. Tablets and desktops do not change.

    Keep? No approved screenshot changes (none shows a post page).

    Answered: approved by the owner on 2026-11-12. The sub-questions keep the
    behaviour as built: the caption on the main photo, the shorter photo frame
    on short screens, the business name block over a paused video and the
    event's logo in the caption.

13. **Business contact (group 13, M10.8).** Contacting a business on a phone now
    takes no more taps than contacting a Market seller (3 against 4, from the
    card to a sent message), inside the existing look:
    - **The bottom contact bar for every business.** Businesses that show no
      number (today every business on the live site, which offers the enquiry
      form) had no bottom bar; their form sat about two and a half screens down.
      They now get the restored bar with one green 'Send an enquiry' button that
      opens the same enquiry form. Businesses with numbers keep Call and
      WhatsApp. A business that turned enquiries off and shows no number still
      has no bar.
    - **The check before a number (your answer to OD-17).** After 'Show contact
      number', the 'are you human' check now stays out of sight unless
      Cloudflare asks for a click; then it is the 150 px compact box, which fits
      a 320 px phone (the 300 px widget stuck out of the card). The check on the
      server, the rate limits and who may see a number are unchanged. The
      enquiry form's check also turns compact on phones narrower than about 364
      px.
    - **Honest empty messages.** 'No contact details added.' no longer shows
      under an email address or website on the same card; if a number comes back
      empty the card says 'No number shared. Send an enquiry instead.'

    Keep? No approved screenshot changes (none shows a business page or a
    contact check).

    Answered: approved by the owner on 2026-11-12. The sub-questions keep the
    behaviour as built: the 'Send an enquiry' bar, the compact out-of-sight
    check before a number and the compact enquiry check on narrow phones, the
    wording 'No number shared. Send an enquiry instead.' / 'No number shared.',
    and no bar for a business that turned enquiries off and shows no number.

14. **The Terms and paid plans paused (group 17, Pricing v2 P1).** As you
    decided today, the site has one set of Terms at `/terms` with no version
    names (old `/terms/versions/...` addresses lead there), switched now, and
    nothing is sold until the R69 checkout is ready; free posting keeps working.
    New wording for you to approve, everywhere a price or a buy button was:
    'Opens soon' on the plan cards; 'Paid slots open soon; your first post and
    events are free.' under them; 'Paid slots open soon. Until then, your first
    post and events are free.' in the posting flow, at checkout and on
    Advertise; 'No active plan. Ended posts are deleted after 3 days. Paid slots
    open soon.' on the dashboard; 'Paid slots open soon. You have not been
    charged.' when a checkout is refused; '7 days from approval' for the free
    post; the sponsor fee shown as 'By written proposal'; and the pricing page's
    search description. Multi-listing and the old sponsor fees are hidden until
    they are on sale. Approved by the owner on 2026-11-12, together with the new
    pricing page pictures.

15. **R69 slots (group 18, Pricing v2 P2).** The R69 Individual slots are on
    sale: the pricing page's 'Choose' buttons and the posting flow's plan step
    open the checkout again (no 'Popular' or 'Best value' badge: there are no
    discounts). The checkout now offers 30, 90 or 180 days and the number of
    slots, shows slot price × slots, and asks for the box you approved before
    Pay. Three new explanations replace Pay when an online purchase is not
    possible (ID review not accepted, all slots held, over R10,000), and an open
    earlier order is named ('Unpaid order: 3 slots, R207'). New screen for your
    design approval: 'My slots' (`/dashboard/slots`, 'My slots' in the dashboard
    menu) lists every slot with the post in it or 'Empty' and 'Create a post',
    its end date and days left, and for 3 days after it ends 'Ended' with
    'Hidden; kept until <date>'; one 'Buy a slot' button opens the 30-day
    checkout. It has no Renew button per slot yet: renewing early (new days
    after the current end, the post staying in its slot) comes with P3, and a
    Renew button that only bought a separate new slot would mislead. Approved by
    the owner on 2026-11-13, with the new pricing page pictures.
16. **Staff fix paid but not delivered (group 20, M3.4).** Staff only. On
    'Payments & Refunds' each paid payment now says 'delivered' or 'not
    delivered'; a line above the list links to 'N paid but not delivered: needs
    attention' and 'N refunds wait for approval', and the Status filter gains
    both lists. A payment that is paid but not delivered has 'Activate what was
    paid for' (asks for an audited reason). 'Record refund' and 'Record
    chargeback' now open a small form in the payment's row (reason list, Ozow's
    refund reference, audited note) instead of the browser's prompt, and an
    order of several slots lists each slot with 'Refund this slot' and 'Slot
    chargeback'. When more than R1 000 would be returned on one payment (slot
    refunds and chargebacks added up), the record shows 'waiting for approval'
    with 'Approve refund' (greyed out for the person who recorded it) and
    'Decline' / 'Withdraw'. Please confirm the five reason labels: 'Billing
    error', 'Duplicate payment', 'Our failure, after a fix was offered',
    'Cancellation (section 14)' and 'Credit for our breach' (which law or term
    'section 14' and 'breach credit' refer to), and whether chargebacks above R1
    000 should keep waiting for a second person (they do now, as the safe
    default; the bank has already taken the money back, so you may prefer them
    to take effect at once). Approved by the owner on 2026-11-13: the screens,
    the five reason labels as they are (to be checked again in the lawyer's
    review of the Terms; 'section 14' is the Consumer Protection Act's
    cancellation of a fixed-term agreement, 'breach credit' money returned
    because the service was not delivered as promised), chargebacks above R1 000
    keep waiting for a second person, and activation keeps the refund permission
    (admins only).
17. **Payment receipt email (group 21, M3.7).** Email only; no page changes.
    After a payment settles, the 'Payment received' email becomes a receipt:
    'Thank you. We received your payment. Keep this email as your receipt.',
    then the invoice number, date paid, item, amount paid (for example 'R
    69.00') and the bank reference on the member's statement, a line asking
    questions to be sent by reply with the invoice number, and a 'See your
    slots' button (add-ons: 'Go to your dashboard'). It no longer sends members
    to Billing, which lists no payments. It says 'invoice number', never 'tax
    invoice'. If the details cannot be read, the email says 'We received your
    payment. Need your invoice? Reply to this email.' and links to the
    dashboard. Answered: approved by owner 2026-11-13, wording approved as
    written.

18. **Hidden until it works, part 2 (group 22, M6.2).** As in your decision
    OD-07, two member features the live backend does not support yet are hidden
    in place, with nothing new added or restyled:
    - **The 'Performance' page.** It reads view, lead and showroom statistics
      the live backend does not record, so every owner saw zeros. The dashboard
      menu (computer sidebar and phone strip) no longer lists it, 'How the
      showroom works' no longer shows its 'See your post's turns' button, and
      its old address opens the dashboard overview.
    - **'Detect province and city'.** The button in the verification location
      step always failed. It and its line 'Detection is approximate...' are
      hidden; members pick their province and city from the list, as before.
      With no change to any screen's design, a search now lists tourism
      businesses (stays, restaurants, tours) under 'Businesses' again, as the
      chosen version did; they open on their Tourism & Events page. Do you
      approve hiding the two features? Before and after pictures are with the
      review notes.

    Answered: approved by the owner on 2026-11-13, as shown in the screenshots.

19. **Phone-sized photos (group 23, M4.3).** Nothing changes on screen. Photos
    uploaded from now on also get 400, 800 and 1 600 px copies, and phones
    download the copy that fits instead of the full-size photo (in the test, a
    post page went from about 3.7 MB to about 110 KB of photos). Older photos
    show their original as before. The copies use the free Cloudflare Images
    allowance the uploads already use: a large photo now counts 4 of the 5,000
    free transformations a month instead of 1, so about 1,250 large photos a
    month can be uploaded before uploads stop until the next month. The setting
    `MEDIA_PHOTO_VARIANTS=off` turns the copies off; the paid Images plan
    removes the limit. Do you approve? Before and after pictures are with the
    review notes.

    Answered: approved by owner 2026-11-13: copies on; MEDIA_PHOTO_VARIANTS=off
    is the switch if the free 5,000 monthly allowance gets close.

20. **Communication choices saved (group 25, M1.7).** The Notifications page
    looks the same, but it now works: the 'Failed to load email activity'
    message no longer appears on every visit, a switch you turn on or off stays
    that way after a reload (before, saving failed and every switch read off),
    and the Email tab lists your own account emails that were sent or failed.
    All four switches (Marketing email, Marketing SMS, Analytics, Third-party
    sharing) start off and each change is recorded with its time and the switch
    wording. Nothing reads the switches yet: no marketing is sent, and
    Cloudflare's cookie-free visitor counting does not follow the Analytics
    switch. Do you approve keeping all four switches visible, or should
    Analytics and Third-party sharing be hidden until something uses them (rule
    2)? Before and after pictures are with the review notes.

    Answered: screens approved by owner 2026-11-13. Open follow-ups, not yet
    answered: whether the Analytics and Third-party sharing switches stay
    visible while nothing reads them; adding the new records to the privacy
    export, the closed-account retention sweep and a staff view of the Terms a
    member accepted; and whether the line under the Google button is enough to
    record a Google sign-up's acceptance of the Terms.

21. **Staff record a bank transfer; a second staff member confirms it (group 24,
    Pricing v2 P2b).** Staff only; customers see nothing new except the usual
    'Payment received' receipt. This is the manual fallback; the Ozow payment
    link on each invoice (a later slice) is the normal way to pay. On 'Payments
    & Refunds', admins get a 'Record a bank transfer' card. Its button opens a
    form, used only after the money has cleared: the customer's account email,
    the slot term (30, 90 or 180 days with the price per slot), the number of
    slots, the order total, the amount received (marked 'Not the order total'
    when it differs), the date it cleared (today by default), the bank
    reference, a tick box 'The customer agreed in writing that their slots start
    now and the 7-day cooling-off does not apply', and the audited reason.
    Before recording, the site looks up the account and the confirmation names
    the customer ('Record R828 from Thandi D. (email) for 2 × 180-day slots?
    They hold 1 of 4 slots. Another staff member must confirm it before the
    slots start.'). Recorded, it waits under 'Waiting for a second staff
    member': amount, customer, slots, bank reference, date cleared, the
    customer's email, who recorded it and why, and a red 'Possible duplicate'
    line when another record names the same customer, amount and date. Another
    admin presses 'Confirm transfer' (after checking the bank statement): only
    then the slots start, the receipt is sent and the partner commission is
    created. The recorder sees 'Confirm transfer' switched off ('You recorded
    it: another staff member must confirm it.') and can 'Withdraw'; others can
    'Decline' with a reason. A confirmed payment appears in the list like any
    other, with 'Bank transfer <reference>, cleared <date>' instead of the Ozow
    reference, and its refund form asks for the 'Bank reference of the refund
    transfer'. Do you approve the card, the waiting list, the form and their
    wording? Pictures are with the review notes. Decided on your direction
    (2026-11-13): two people for every bank transfer ('Prioritize security'),
    with a separate admin-only permission to confirm; recording keeps the refund
    permission (admins only); a bank reference is used once, ever (also after a
    decline); bank transfer is meant for orders above R10,000, Ozow stays the
    normal way to pay, and staff recording is not blocked below that; for the
    later invoice slice: pay reference = invoice number (VM-YYYY-NNNNNN, in
    order with no gaps), 'Invoice' with no VAT line, cooling-off consent as a
    tick box stored with its time when the customer asks for the invoice, and
    your bank details as a server setting you enter yourself, never in the code.

    Answered: approved by owner 2026-11-13 (screens and wording as shown; the
    update was applied the same day). Open follow-ups, not yet answered: how a
    transfer recorded with wrong details is corrected once declined (its
    reference cannot be used again), and whether waiting records should expire.

22. **Hidden until it works, part 3 (group 27).** Pages and buttons that still
    read the retired backend showed an error or did nothing. They are hidden in
    place until they work (your rule 2), as the Performance page was in group
    22:
    - **Staff:** 'Commercial settings', 'Free posts & trials', 'Programmes &
      contracts', 'Operations health' and the six Intelligence pages ('Users &
      growth', 'Verification metrics', 'Revenue & costs', 'Marketplace health',
      'Trends', 'Operations summary') leave the menu, and their addresses lead
      to the staff home. On the staff home, the 'Decisions not applied' card is
      gone and the four 'Platform health' rows no longer link to Operations
      health. On a founding-pilot organisation, 'Offer a pilot extension' is
      gone.
    - **Organisation admins:** the 'Performance' tab with 'Download report
      (CSV)' and 'Last 30 days (CSV)' is gone (the report was always empty).
    - **Members:** 'Delete account' is gone from the profile's Account tab (it
      did not work, SEC-02). In its place one small line says 'To close your
      account, send us a data request.', linking to the data request form, which
      already offers 'Delete My Data'. Is this line acceptable, or should the
      space stay empty?

    Do you approve hiding them? Before and after pictures are with the review
    notes.

23. **Staff refunds through Ozow (group 28).** Staff only, and nothing changes
    until you switch it on (Worker setting `OZOW_API_REFUNDS_ENABLED`, after the
    Ozow set-up in the pull request). Then, on 'Payments & Refunds', a payment
    paid through Ozow has 'Refund through Ozow' instead of 'Record refund': the
    same reason list and audited note, no Ozow reference to type; the server
    sends the refund to Ozow once the approval rules pass (above R1 000 a second
    staff member presses 'Approve and send to Ozow'), and the slot or plan is
    taken back only when Ozow reports the refund complete. 'Recorded in the Ozow
    dashboard' (admins) is the separate path for a refund already made by hand
    in the Ozow dashboard, with Ozow's refund id. Each payment lists its Ozow
    refunds ('sent to Ozow', 'refunded', 'failed at Ozow', 'came back from the
    bank'), and a 'Refunds that need staff' card lists failed, returned or stuck
    ones, with 'Close: never reached Ozow' for a refund that Ozow never received
    (another staff member, with a reason). Chargebacks and bank-transfer
    payments keep the reference form. Do you approve the buttons, the card and
    their wording? Pictures are with the review notes.

    Answered: approved by owner 2026-11-14 (screens and wording as shown; the
    update was applied the same day). Refunds through Ozow stay switched off
    until you switch them on after the Ozow set-up.

24. **Bank transfer and consent fixes (group 29).** Fixes from the review of
    groups 24 and 25, mostly text outside the checked scope. Staff: on the
    waiting bank transfers, 'Possible duplicate: N other record(s) have this
    bank reference and amount, or this customer, amount and date. Check the bank
    statement.' (a withdrawn transfer can now be recorded again); the refund
    form's own messages name no provider ('Enter the refund reference.'; a bank
    reference may have spaces). Members: the receipt email's 'Date paid' is the
    day a bank transfer's money cleared, a payment refunded before its receipt
    goes out gets no receipt, and the communication page says 'Your session has
    ended. Sign in again.' when the session ended; and the outcome of
    confirming, declining or withdrawing the last waiting bank transfer stays on
    screen. Do you approve the wording?

    Answered: approved by owner 2026-11-14 (wording as shown; the update was
    applied the same day). Still open, outside this ledger: the lawyer's
    retention period for consent records and the choice of bank reference rule.

25. **Video length and seller guidance (group 30, M4.4 part A).** Your rule of
    11 November (every video at most 2 minutes, event videos at most 1 minute)
    now runs on the phone before upload and on the server at upload. Every video
    field shows your approved guidance under its label: 'Up to 2 minutes
    (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30
    seconds — put the best part first.' A longer video is not added, with its
    real length: '"clip.mp4": Your video is 2 min 40 s; the limit is 2 minutes.'
    The line 'Videos (MP4, WebM, MOV) up to 50 MB' loses 'up to 50 MB', because
    a phone original up to 300 MB is now converted first; only the stored file
    must be at most 50 MB. The business profile video's 'Max 50 MB.' is replaced
    by the guidance. No progress bar or Cancel button was added while a video
    converts (that would be new design). Do you approve the wording and
    placement?

26. **Customer invoices with Pay now (group 31).** New screens. Staff issue an
    invoice for a customer's Individual slots on 'Payments & Refunds'
    ('Invoices' card: customer email, term, slots, days to pay, reason); the
    number is VM-YYYY-NNNNNN, in order without gaps, and a voided invoice keeps
    its number. Staff open the invoice and send the customer its link. The
    customer, signed in, sees the invoice ('Invoice', 'VerifyMzansi is not
    registered for VAT.', no VAT line), adds their business name, address and
    registration number, ticks the cooling-off box and presses 'Pay now' (Ozow);
    the slots start when Ozow confirms the payment, with the usual receipt
    email. 'Print or save as PDF' prints the invoice alone. The bank transfer
    box and your street address appear only once you set them as Worker secrets.
    A bank transfer to an invoice is recorded on the invoice ('Record a bank
    transfer to this invoice') and pays it once a second staff member confirms
    it; meanwhile the customer sees 'Your bank transfer to this invoice is being
    checked. You do not need to pay again'. The 'Record a bank transfer' card
    gains one line pointing there. Do you approve the screens and their wording?
    Should 'Invoices' get a link in the dashboard menu or on 'My slots' (not
    added yet)? Pictures are with the review notes.

    Answered: approved by owner 2026-11-14 (screens and wording as shown; the
    update was applied the same day). Invoice numbers start again from 000001
    each year: yes. No 'Invoices' link in the customer menu for now: staff send
    the customer the link.

27. **Renew early (group 32, Pricing v2 P3).** Your renewal rule of 14 November:
    a slot can be renewed from 14 days before it ends, and the new days start
    exactly when the current ones end, so the post stays live with no break and
    nothing is lost. 'My slots' gets a 'Renew' button on each Individual slot
    (before the 14 days: 'You can renew from <date>.'), 'Renew all' when two or
    more can be renewed, and 'Renewed until <date>' on a renewed slot. The
    checkout then shows 'Renew your slot(s)', each slot with its new days, one
    payment for all of them, and a new box that names the start date: 'My new
    days start on <date>, when my current days end. If I ask to cancel before
    they start, I get a full refund; once they start, the 7-day cooling-off no
    longer applies.' with an 'Ask to cancel' link (an email to billing: members
    cannot cancel themselves; staff refund the slot) (never 'My slot starts
    now'); changing the slots clears the box. Three days before a slot ends, the
    member gets one email: subject 'Your slot ends soon', 'Your Individual slot
    ends on <date and time> (South African time). Renew it now and your new days
    start when the current ones end, so your post stays live without a break.'
    (when another slot also ends within 7 days: '... and another of your slots
    ends within 7 days. Renew them together in one payment: ...'), then 'Nothing
    renews automatically. If you do not renew, the post in this slot is hidden
    when the slot ends and deleted 3 days later, with its photos and videos.'
    and a 'Renew my slot' (or 'Renew all') button. Do you approve the screens
    and this wording? Pictures are with the review notes.

    Answered: approved by owner 2026-11-14 (screens, checkout wording and the
    reminder email as shown; the update was applied the same day). The reminder
    is a service notice with no opt-out. Follow-ups: the gap when a current
    period is refunded while a renewal is queued, and a staff refund reason
    'cancelled before the renewal started'. A 'Renew all' above R10,000 is paid
    by invoice, which comes with the Multi-listing packages (P4).

28. **Multi-listing packages, part one (group 33, Pricing v2 P4a).** New
    screens, all hidden while packages are not on sale (your switch in the
    database): 'Choose your package' (a typed number of slots from 5 with the
    shortcuts 5, 10, 25, 50 and 100, 30, 90 or 180 days, R100 per slot per 30
    days, the 'My slots start now' tick; above R10,000 or 100 slots 'paid by
    invoice' with an 'Ask for an invoice' link; fewer than 5: 'Packages start at
    5 slots. For 1-4, use Individual slots (R69).'), the package group on 'My
    slots' (slots in use, the shared end date, the posts in it, the Individual
    slots beside it closed until its last 7 days), the hidden Multi-listing
    page's new words and prices, and the messages when an Individual slot,
    renewal or invoice is refused while a package runs. Do you approve the
    screens and this wording? Pictures are with the review notes (p4a-v2).

    Answered: approved by owner 2026-11-16, after the p4a-v2 screenshots: the
    package checkout, the online limit and invoice message, the 'fewer than 5'
    message, My slots with a package and in its last 7 days, the hidden
    Multi-listing page and the refusal messages. Follow-up before sales go on:
    the hidden page's team wording ('You + 1 person (you + 4 from 50 slots)') is
    corrected with the team (P4c).

29. **Invoice choice and Ozow's maximum (group 36).** Your decisions of 16
    November: the R10,000 online limit is gone, and the checkout shows two ways
    to pay at every amount without asking everyone a question. The main button
    stays 'Pay R… securely' (Ozow; the invoice is still emailed after payment).
    Under it, one small line: 'Need an invoice before you pay? Get an invoice'.
    'Get an invoice' opens: 'We email you an invoice for this order. Pay it with
    Pay now (Ozow) or by bank transfer; your slots start once it is paid.', a
    button 'Email us for the invoice' and 'Send it from your account's email
    address. You add your business details on the invoice.' The button opens an
    email to billing@verifymzansi.com with the slots, days and total filled in
    and the line 'I confirm: My slots start as soon as this invoice is paid; the
    7-day cooling-off does not apply because the service starts immediately.'
    (the written confirmation the Terms ask for when an invoice is paid by EFT);
    staff issue the invoice as today. Above Ozow's maximum (R1 300 today, one
    setting in the database) the checkout shows only the invoice: 'Ozow takes
    payments of up to R1 300. For this order, get an invoice and pay it by bank
    transfer.' (four 180-day slots, R1 656, are already above it). A renewal
    above it says 'Ozow takes payments of up to R1 300. Untick some slots and
    renew them in a second payment.' (renewals are not invoiced). An invoice
    above it shows no Pay now ('Ozow takes payments of up to R1 300, so pay this
    invoice by bank transfer. ...') and its 'How to pay' offers only the bank
    transfer. Multi-listing packages use the same limit instead of R10,000: with
    R1 300, at most 13 slots for 30 days are paid online and every 90- or
    180-day package is by invoice ('Ozow takes payments of up to R1 300, so this
    package is paid by invoice, at the same price.'); the price lists show 'By
    invoice' for those sizes. New Terms (posting-v5) say all this; everyone
    accepts them once before their next post. Do you approve the screens and
    this wording? Pictures were sent to you directly with the review notes (not
    in the repository).

    Answered: approved by owner 2026-11-17, after the invoice-choice screenshots
    (phone and desktop): the checkout's invoice option, the screens above Ozow's
    maximum, the invoice and package screens and the posting-v5 Terms. The owner
    also approved applying both database updates.

30. **The site matches the Terms (group 40).** The public pages promised what
    the Terms (posting-v5) or the site do not: the Business Sponsor offer
    (programme on hold), paid add-ons (not on sale, not delivered), 'Up to 2
    approved edits' (the site allows up to 2, 6 or 12 for a 30-, 90- or 180-day
    slot), '1 live slot' (the Terms allow 1 to 4), a 'Can I cancel?' answer that
    contradicted the refund and cooling-off rules, a free post described as a
    campaign with limited places, and 'VAT number not currently published' (the
    company is not registered for VAT). The offers are hidden until they work
    (rule 2) and the wording now states the Terms; group 40 lists every line
    before and after. Do you approve? Pictures (375 px, before and after) go to
    you with the review notes (not in the repository).

    Answered: approved by owner 2026-11-17.

31. **Account events in the bell (group 41).** A member reported that their ID
    was accepted but the bell showed nothing. Until now most account events
    reached members only by email, and approving or rejecting a post, a
    staff-issued invoice and a held post shown again told the member nothing at
    all. With database update `20261117140533_member_notices_in_app.sql` the
    bell (same look, no new element) also lists, each with an 'Open' link: 'Your
    ID check was accepted' ('Your identity is verified. Open verification to see
    any steps that remain.', to Verification); 'Mobile number verified' ('Your
    mobile number was verified on your account. Not you? Contact support.');
    'Payment received' ('We received your payment. Your receipt and invoice were
    emailed to you.'), 'Refund recorded' ('Part or all of a payment was refunded
    or reversed. The details were emailed to you.'), 'Payment being checked'
    ('We received your payment but could not apply it automatically. We are
    checking it; there is no need to pay again.'), all to My slots; 'New invoice
    to pay' (to Invoices); 'Your introductory posting allowance is ready' (to
    the dashboard); 'Your post is live', 'Post not approved' ('“Red bicycle” was
    not approved. Open your posts to see why and what to change.'), 'Your
    changes are live', 'Changes not approved', 'Your post is visible again',
    'Post expired', 'Post marked as sold', 'Post kept after your payment', 'Post
    will be deleted soon' ('… is not showing and has not been changed for 45
    days. Update it within about 15 days to keep it, or it will be deleted with
    its photos and videos.'), 'Post deleted' (to My posts); 'Your slot ends
    soon' (to My slots). Post notices name the post when it still has a title.
    No email changes: post approvals and rejections, invoices and restored posts
    still send none, and the existing payment emails still point to Billing (the
    pricing page), which shows no payments. Do you approve these notices and
    their wording?

32. **A working Delete account button (group 43, roadmap M1.6c).** 'Delete
    account' on the profile's Account tab was hidden (group 27) because it did
    not work. It now closes the account through the live backend (database
    update `20261116175757_close_and_erase_account.sql`, already applied). It
    stays hidden behind its switch until you approve it; once switched on, it
    is shown again in the chosen version's place and style. On phones the dialog
    sits at the bottom of the screen so the site header does not cover its
    title. Changes to the chosen version: the line under 'Delete account' no
    longer says 'Removes your account and personal data for good.' but 'Closes
    your account and erases your data, except records we must keep by law, such
    as payments, invoices and ID-check history. See our Privacy Policy.'; the
    dialog lists what happens; and it no longer asks for the current password.
    Instead the website requires a password or Google sign-in from the last 15
    minutes (a session opened by a reset or other emailed link does not count);
    when the sign-in is older, the dialog says 'Your session needs a fresh
    sign-in. Sign in again', which signs out this device and returns to the
    Account tab after signing in. The dialog text: 'Your account closes as soon
    as you confirm. You can't undo this or reopen the account yourself.', then
    'Your posts leave the site at once and are deleted with your account.'; 'As
    our Terms say, closing your account counts as a request to cancel all your
    slots. If you are an individual or sole trader, we work out any credit for
    unused days after the 20-business-day notice period, minus a R50 fee; a
    30-day slot usually returns nothing. Companies and other buyers that are not
    individuals get no credit.'; 'You are signed out on every device and can't
    sign in again.'; 'Erasing your profile, posts, enquiries, photos and videos
    is planned for <date>, 30 days after closing. If a payment, refund, invoice,
    report or legal hold is still open, erasure waits until it is settled.';
    'Payment records and invoices are kept for 5 years for tax, as the law
    requires. Some other records, such as ID-check history, are kept as our
    Privacy Policy says.'; 'For your safety, this works only within 15 minutes
    of signing in with your password or Google.'; 'Type DELETE to continue.'
    After closing: 'Account closed. Your account is closed and you are signed
    out. Erasure is planned for <date>; it waits while a payment, refund,
    invoice, report or legal hold is still open.', the line under 'Delete
    account' reads 'Your account is closed. Erasure is planned for <date>.' (no
    button), then the home page. When the answer is lost: 'Account status
    unknown. We couldn't confirm whether your account was closed. Try signing
    in: if you can't, it was closed. Contact support if unsure.' Do you approve
    the button, the texts and the fresh sign-in step? Pictures (375 px) go to
    you with the review notes (not in the repository).

    Answered: approved by owner 2026-11-19. The switch `SHOW_ACCOUNT_DELETION`
    stays off in production until the staff half is built, and goes on before
    launch.

<!-- frontend-ledger:start -->

## Differences

### 1. Phone and tablet filter (visual)

None left: the three filter files were put back to `0b562f42` (see "Put back").

### 2. Member and public wording or behaviour

| File                                                   | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Proposed                                         | Owner decision                                                                                                                                                                                                                                                                                                                                                                               | Date       | Version      |
| ------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/components/billing/billing-faq.tsx`               | wording-behaviour | The answers about plan end, slots, the trial end and events state the post lifecycle rules decided on 9 November 2026. Retired-backend removal: retired-backend branch removed. Group 40: the free post answer states the Terms' 'Free first post & visibility' rules (no campaign or limited places). Group 98: the free post answer no longer mentions boosts, featured placement or an urgent badge (paid add-ons removed). | Billing FAQ: when a plan ends, posts are hidden, the member is emailed and has 3 days to buy a plan and reactivate a post, then it is deleted with its photos and videos (up to 24 hours more while a payment is confirmed; kept 3 days after a confirmed payment). A sold post keeps its slot until it is deleted 3 days later; a deactivated post keeps its slot; a new post runs for the plan's remaining days. Trial end: reactivate within 3 days (prices R50 / 30 days, R140 / 90 days or R250 / 180 days, now read from the retail price ladder) or the post is deleted. Events are deleted when they end. Chosen version: posts stay saved in the dashboard and can be reactivated. Pricing switch (group 17): the trial answer reads 'post once for free for 7 days from approval, in Mzansi Market, Mzansi Business or Tourism. It is one post across all sections.' (the 30-day launch trial and its pool are gone); no price is quoted while paid slots are paused ('When the trial ends your post is hidden; buy a slot within 3 days to reactivate it, or it is deleted.'); 'Each slot holds one live post, and you can hold up to 4 Individual slots at a time.'; a rejected post: 'the slot stays yours: correct the post and submit it again, or use the slot for another post.' (no refund promise). Group 40: the free post answer reads 'Once your ID has been reviewed, your first post is free for 7 days, in Mzansi Market, Mzansi Business or Tourism. It is one post across all sections. The 7 days start when we approve the post, not when you submit it.', 'When its 7 days end your post is hidden; ...', 'The free post is available once per ID-reviewed person. Once its 7 days have started it is used for good; deleting the post or your account does not reset it. Previous free-post usage counts.', 'A rejected post does not use the free post; you may correct it and submit it again. Only one post at a time can wait for the free post.' and 'If, when that post is approved, you already have an unused paid slot with at least 7 days left that allows its photos and video, the post uses that slot instead and your free post stays unused. A sponsored place, or a free post we grant you, counts as your free post.' Gone: 'phone, ID, selfie and location verification', 'Starting a form does not reserve a slot ...', 'removal or expiry frees the space for another member', the invitation-only programmes paragraph and 'Campaign availability can change ...'. 'How do I pay?' ends 'VAT status: not registered for VAT.' (was 'VAT number not currently published'). Group 98: Billing FAQ, free post answer: the sentence 'Free posts have standard placement: no boosts, featured placement or urgent badge.' is gone. | keep                                             | approved by owner 2026-11-09 (post lifecycle rules); pricing switch part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 40 part approved by owner 2026-11-17; group 98 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 8902a72c762e |
| `src/components/billing/plan-gate.tsx` | wording-behaviour | The posting plan box reads plans and limits from the new backend; its slot line states the post lifecycle rules. Retired-backend removal: retired-backend branch removed. Browser client imported from the foundation module. Group 40: paid add-ons are hidden until they deliver (owner rule 2). Group 98: the 'Optional Urgent label add-on' line and its switch are removed (paid add-ons removed). Group 101: the 30-day launch trial and account free-post branches are removed; the backend never offers them (thirtyDayAvailable is always false and the live allowance has no account free posts), so no page can promise more than the 7-day free post. | New message 'New post allowance used' when a slot is free but the plan's limit for new posts is reached. If the limits cannot be loaded, photo and video limits show 0. The plan feature line reads '1 active posting slot, reusable once its post is deleted' (was 'reusable when an item sells'). Pricing switch (group 17): with no plan on sale the plan grid is replaced by 'Paid slots open soon. Until then, your first post and events are free.'; the old 'R50 / 30 days, R140 / 90 days or R250 / 180 days.' line lists the plans on sale or shows that note; the 30-day launch option and its text are gone; no multi-listing suggestion. R69 slots (group 18): the posting flow's plan step lists the R69, R207 and R414 Individual slot (any section) and its 'Choose' buttons open its checkout; the 'Popular' and 'Best value' badges are gone (no discounts). Group 40: the posting flow's plan cards no longer list 'Optional Urgent label add-on'. Group 98: Posting plan box: no 'Optional Urgent label add-on' line. Group 101: nothing today (those branches could not show); the posting plan box offers only 'Choose 7 days free'. | keep | approved by owner 2026-11-09 (post lifecycle rules); pricing switch part approved by owner 2026-11-12; R69 slots part approved by owner 2026-11-12 (pricing switch); retired-backend removal part awaiting owner; group 40 part approved by owner 2026-11-17; group 98 part approved by owner 2026-11-25 (answer: 'Approve them'); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 275f43d7f32d |
| `src/components/listings/content-contact-actions.tsx` | wording-behaviour | The new backend asks for a human check before it reveals a seller's number. M9.4: reads the security token through a browser-only helper, so the post and business pages no longer download Next's server request code (about 28 KiB). M10.1: closing the report dialog returns keyboard focus to the Report button (WCAG 2.4.3). M10.8: the check before a number is Cloudflare's compact widget, out of sight unless Cloudflare asks for a click (owner decision OD-17); the normal 300 px widget stuck out of the card on a 320 px phone. The server check, rate limits and who may reveal a number are unchanged. An empty answer is said plainly, and 'No contact details added.' only shows when the page has no other way to reach the owner. Retired-backend removal: retired-backend branch removed. Group 66: WhatsApp is a secondary action beside 'Show contact number'. | After tapping 'Show number', a short 'are you human' check appears before the number is shown. (M9.4: nothing changes on screen.) M10.1: nothing visible; after the report dialog closes, focus is back on 'Report' instead of the top of the page. M10.8: after 'Show contact number' most visitors see only the button's spinner, then the number; when Cloudflare wants a click, a 150 px box appears under the button, centred (was 300 px, wider than the card at 320 px). If no number comes back: 'No number shared. Send an enquiry instead.' (or 'No number shared.'). A business card that shows an email, website or social link no longer says 'No contact details added.' under it. Group 66: Post pages, contact card: 'WhatsApp' is outlined (white with a grey edge, same icon and words) instead of filled green; 'Show contact number' stays the one filled button; 'Send an enquiry' was already outlined. | keep | approved by owner 2026-11-12 (M9.4 and M10.1; earlier change approved 2026-11-09); M10.8 part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 3f6b3a7dad6b |
| `src/app/(marketplace)/promotions/events/page.tsx`     | wording-behaviour | Event lists come from the new backend, sorted by date only. Retired-backend branch removed. Group 114: a code comment no longer says 'boosted first'. | Nothing today: this address permanently redirects to Tourism & Events. Group 114: Nothing | keep                                             | approved by owner 2026-11-09 (keep); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 40dd2c1087ed |
| `src/app/billing/cancel/page.tsx`                      | wording-behaviour | Adds a state for payments that need a manual check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | If a payment needs a manual check, the page says so and offers 'Contact support'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep                                             | approved by owner 2026-11-09 (keep)                                                                                                                                                                                                                                                                                                                                                          | 2026-11-08 | a68af2814a76 |
| `src/app/billing/checkout/checkout-confirm.tsx` | wording-behaviour | The 'After expiry' line comes from the new backend; the slot line states the post lifecycle rules. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). P4a (group 33): the 'Secure checkout' bar and the pending payment buttons now come from two shared pieces (`checkout-shell.tsx`, `pending-payment-actions.tsx`) that the package checkout uses too. Group 66: When the ID review blocks buying a slot, going to it is the main action. Group 96: the consent box links the Terms too (ECTA s43), through the shared `checkout-terms-links.tsx`. Group 114: says no VAT is charged under the total. | Checkout: 'Active posting slots' reads '1 at a time, reusable once its post is deleted' (was 'reusable when a post sells or ends'). 'After expiry' reads 'Posts are hidden. Buy a plan within 3 days to reactivate them, or they are deleted with their media.' Chosen version: 'stay saved in your dashboard for reactivation'. M10.2: the 'PLAN DETAILS' label reads 'Plan details' in normal letter spacing; same size, colour and place. Pricing switch (group 17): with no plan on sale the page says 'Paid slots open soon. Until then, your first post and events are free.' instead of 'This plan is not available...'. R69 slots (group 18): for an Individual slot the page offers 30, 90 or 180 days (the linked term chosen first, 30 days from every other entry point) and a − / + number of slots; the total is the slot price × slots, with 'R207 × 2 slots' under it; 'Section' reads 'Market, Business or Tourism', 'Each slot' 'Holds one post at a time, reusable once its post is deleted', 'Fair use' 'Up to 4 posts going live per slot per 30 days'; before Pay a box to tick: 'My slot starts now; the 7-day cooling-off does not apply because the service starts immediately.' with a 'Refunds' link, and Pay stays off until it is ticked. Instead of the box and Pay it explains: 'Your ID review must be accepted before you buy a slot, so you never pay for days you cannot use.' with 'Go to my ID review'; 'You can hold 4 Individual slots at a time. A slot frees up when it ends.' with 'My slots'. The R10,000 note is replaced: above Ozow's maximum only the invoice is offered (group 36, owner approved). When an earlier unpaid slot order is still open, a line above Continue and Cancel names it: 'Unpaid order: 3 slots, R207' (new wording). Renew early (group 32): opened from 'Renew' or 'Renew all' on My slots, or from the reminder email, the page renews the member's own slots instead of buying new ones: heading 'Renew your slot' (or 'Renew your slots'); each slot with its post (or 'Empty slot') and 'New days: <start> – <end>', with a box per slot to leave one out when several are listed; 'Starts' reads '<date> (when your current days end)' (several: 'When each slot's current days end') and 'Expires' '<date>' (several: '<n> days after each start'); the box before Pay reads 'My new days start on <date>, when my current days end. If I ask to cancel before they start, I get a full refund; once they start, the 7-day cooling-off no longer applies.' (several slots: 'My new days for each slot start when its current days end (dates above). If I ask to cancel ...'), followed by an 'Ask to cancel' link (email to billing) and 'Refunds'; changing the slots clears the box, never 'My slot starts now'; no 'You can hold 4 Individual slots' notice (a renewal adds no slot); 'Back to My slots' instead of 'Back to pricing'; 'Your post stays in its slot when the new days start.'; with nothing to renew: 'Nothing to renew right now. A slot can be renewed from 14 days before it ends.' (or 'Your slots cannot be shown right now. Please try again in a few minutes.') with 'My slots'; an open earlier renewal is named 'Unpaid renewal: 2 slots, R138' (new wording). P4a (group 33): nothing changes on screen. Group 66: Checkout, while the ID review is not accepted: 'Go to my ID review' is filled green (was outlined); the greyed-out Pay button is unchanged. Group 96: after the consent text, 'Terms · Refunds' instead of 'Refunds' (both open in a new tab). Group 114: Individual slot checkout: a small grey line 'No VAT is charged.' under the total. | keep | approved by owner 2026-11-09 (post lifecycle rules); M10.2 part approved by owner 2026-11-12; pricing switch part approved by owner 2026-11-12; R69 slots part approved by owner 2026-11-12 (pricing switch); its three explanations and the unpaid-order line approved by owner 2026-11-13; renew early part approved by owner 2026-11-14; P4a part (group 33) approved by owner 2026-11-16; group 66 part approved by owner 2026-11-20; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | cf602949fd97 |
| `src/app/billing/success/payment-status-panel.tsx` | wording-behaviour | Adds a state for payments that need a manual check. Group 60: shows the package confirmation once a package payment is delivered, and reads it once when it is confirmed while the page is open. | If a payment needs a manual check, the payment result page says so and offers 'Contact support'. Group 60: after paying for a Multi-listing package, 'Your package is active' (see `src/components/billing/package-confirmed.tsx`) instead of 'Payment confirmed'. | keep | approved by owner 2026-11-09 (keep); group 60 part approved by owner 2026-11-19 | 2026-11-19 | 4249a017299a |
| `src/app/dashboard/layout.tsx`                         | wording-behaviour | Menu badges read from the new backend; the suspension notice moved into the dashboard home page. Retired-backend branch removed. Browser client imported from the foundation module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Badge counts come from the new backend. On dashboard pages other than the home page, a suspended member no longer sees the suspension banner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | keep                                             | approved by owner 2026-11-09 (keep)                                                                                                                                                                                                                                                                                                                                                          | 2026-11-08 | 8bd0f67e4c2a |
| `src/app/dashboard/page.tsx` | wording-behaviour | Reads from the new backend, incl. ended Market posts' deletion dates; reuses the sign-in gate's check (M9.2). Retired-backend removal: retired-backend branch removed. Group 61: the posts box reads each publicly listed post's view total from the new backend while SHOW_ENGAGEMENT_TOTALS is on. Group 66: One main button on the dashboard: while the member has an ID review step to do, the verification card's button is the main one. | A suspended member sees only the suspension notice. Trial extension offers are not shown. The posts box shows 'Will be deleted on <date>' on ended posts. The trial card gets the member's free week from the new backend (M2.3, see its row). M9.2 changes nothing on screen. Group 61 (only while the counters are shown): each post in the posts box shows its real view total instead of 0. Group 66: Dashboard banner: while the member has an ID review step to do (not started, unfinished or not accepted), 'New post' is outlined white on the green band (was gold); while the review is in progress (the card's button is outlined) and once the ID is reviewed, 'New post' stays gold and 'My posts' outlined as before. The gold now stays gold in dark mode. | keep | approved by owner 2026-11-12 (M9.2; earlier change approved 2026-11-10); retired-backend removal part awaiting owner; group 61 part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 487b187a577b |
| `src/app/dsar/page.tsx`                                | wording-behaviour | Legal reference corrected for a private body.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Privacy request page: 'The PAIA section 25 timeframe' now reads 'For access requests, see sections 56 and 57 of PAIA.'                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep                                             | approved by owner 2026-11-09 (keep)                                                                                                                                                                                                                                                                                                                                                          | 2026-11-08 | 5927dec0494d |
| `src/app/help/business-verification/page.tsx` | wording-behaviour | Guidance about the free CIPC disclosure reworded. Live-test fix (group 35): names its canonical address (`/help/business-verification`). Group 66: The main button on a dark-green band is gold. Group 101: the ID reviewed sticker's wording is true on every ID check setting (staff or Didit). | The help text no longer mentions BizPortal or 'Costs nothing'; it says the free disclosure has limited information and is for initial review. Group 66: Business verification help: 'Verify my business' in the dark-green hero is gold (the dashboard banner's gold) instead of green. Group 101: Business verification help: the ID reviewed card reads 'We reviewed the phone, ID and selfie of the person who runs the profile.' (was 'Our team reviewed ...'); the stickers' lede reads 'Each one is reviewed before it shows.' (was 'Each one is reviewed by our team.'). | keep | approved by owner 2026-11-09 (keep); group 66 part approved by owner 2026-11-20; group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | a1f2c8e8f76b |
| `src/app/privacy/page.tsx` | wording-behaviour | ID-evidence and post retention wording matches what the new backend does. Retired-backend branch removed. Phone bans (17 November 2026): the phone number row now says how long a banned account's numbers are kept. Live-test fix (group 35): names its canonical address (`/privacy`). Group 57: the 'Showroom location' line is removed: the showroom no longer estimates the visitor's province from the connection or remembers a chosen one (row A16). Group 61: the view-counting paragraph says what the new backend stores for views and likes (a keyed hash of a random browser identifier; no network address). Group 61: says the identifier is given after a Cloudflare Turnstile check. Group 66: An e-mail address is not a main action. Group 88: the showroom uses the visitor's approximate area again, so the notice says so (plan question 6). Group 88: the view-counting paragraph also says showroom appearances store the same daily one-way hash. Group 101: the notice matches what the system does and carries every POPIA section 18 item (settled legal answers D3, D4, D5 notice part, D7, D11; item 41). Group 951: payment records are kept 7 years and privacy request records 3 years (item 51, settled legal answer D5); contact-form messages are deleted 12 months after they are resolved. | Privacy policy: ID images, selfies and the encrypted ID number are deleted 30 days after the case decision; unfinished evidence after 90 days; open holds pause deletion. Chosen version tied the encrypted ID number to the account. Retention now says 'We retain account data while your account is active' (was 'account and listing data') and adds: posts are deleted 3 days after their plan ends or after being marked sold, events when they end, with their photos, videos and enquiries; a pending payment, an open report or a legal hold can delay deletion. Header date: 'Updated November 2026'. Phone bans: the 'Phone number' row's retention adds 'If an account is banned, the numbers it verified are kept for 5 years (or until the ban is lifted) so they cannot be used to verify again'. Group 57: under 'Information we collect', the 'Showroom location' paragraph is gone. Group 61: 'Information we collect': 'View counting: ... a one-way hash of your network address for 90 days ...' becomes 'View and like counting: your browser gets a random identifier in a cookie (kept for a year). We store only a one-way, keyed hash of it: for views for 48 hours ...; for likes for as long as the post is up ... We do not store your network address for counting. Post owners only see totals.' Group 61: 'View and like counting: after a Cloudflare Turnstile check, your browser gets ...'. Group 66: Privacy Policy, 'Data subjects & contact': the Information Officer's e-mail address is a green underlined text link with its envelope icon, instead of a filled green button. Group 88: under 'Information we collect', a new paragraph before 'View and like counting': 'Showroom area: when you open a page with a showroom, we estimate your province and city from your internet connection so we can show posts near you first. It is used only for that page and is not stored.' Group 88: 'View and like counting' adds, after the views sentence: 'A post appearing at the front of a showroom stores the same kind of daily one-way hash, so it counts once a day for you.' Group 101: Privacy Policy: new first section 'Who we are' (registered name and number from the company details, registered address 'the one recorded at CIPC', legal notices to legal@verifymzansi.com; no street, no owner name); new section 'Cookies and browser storage' (sign-in and security cookies, the view-and-like cookie, the 30-day partner link cookie vm_acq, browser storage); 'What we collect' adds where information comes from, what is voluntary or needed and the tax-law reason, and says screen replays are not recorded (was: replays recorded for a small share of visits); verification says staff or Didit check IDs, consent first, and the 5-day 'ask a person'; 'Show number' no longer says taps are logged; the keep-for periods follow the applied rules (ID photo 30 days; selfie and ID number 90 days after closing; names, verified phones and the one-way code 5 years after closing; failed checks keep only the one-way code; trial token 3 years; home area 30 days after closing; payments 5 years after the tax year; enquiries 1 year; notices 90 days; logs 2 or 5 years; erasure 30 days after closing); rights add 'ask a person' and the Regulator's eServices portal and enquiries address; 'Third parties' names every provider and the countries (United Kingdom, European Union, United States, Kenya); the biometric note says POPIA treats it as special personal information. Review round: a banned ID keeps the one-way code 5 years, and the selfie, ID number, names and verified phones only if the ID had been accepted (the ID photo still goes after 30 days); the vm_acq cookie line reads 'Where you came from' and covers search and social referrals, channel counts and that it is stored with the account at sign-up; kept invoices keep the name and address on them. Group 951: the 'Payment data' row reads 'Kept for 7 years after the end of the tax year (1 March to the end of February) in which the payment was made, as company and tax law require' (was '5 years ... as tax law requires'); the retention section says the record of a data-rights request is kept for 3 years (was 5), and adds 'Messages sent through the contact form are deleted 12 months after they are resolved.' after the enquiries and notices sentence. | keep until the privacy text has its legal review | approved by owner 2026-11-09 (post lifecycle rules); phone-ban retention sentence approved by owner 2026-11-17; group 57 part awaiting owner; group 61 part awaiting owner; group 66 part approved by owner 2026-11-20; group 88 part awaiting owner; group 101 part approved by owner 2026-11-25 (answer: 'Approve them'); group 951 part approved by owner 2026-11-26 | 2026-11-26 | 5fc112909073 |
| `src/app/dashboard/profile/page.tsx`                   | wording-behaviour | Sends revision; skips locked display name. Secure email change emails both the current and the new address. Retired-backend branch removed. Browser client imported from the foundation module. Group 27: 'Delete account' is hidden until it works (SEC-02); the line under 'Sign out' points to the data request form instead. Group 43 (M1.6c): 'Delete account' works on the live backend (fixes SEC-02); it stays behind its switch until the owner approves it, and is shown again when the switch is on; the dialog states what closing does and asks for a recent sign-in instead of the password. Group 74: the profile and the verification steps are read through two named live-backend reads instead of old table-style calls that the browser client translated into the same reads. Group 97: the delayed full-page load after an account is closed is dropped if the page has already gone (unmounted), so it can never run later; a test fix, the redirect itself is unchanged. Group 107: the phone shows read-only with 'Change number' (the phone step in change mode); province and city stay editable once confirmed, with a 15-day note; a refused change says when it is allowed. Group 114: the Delete account dialog names the package. Group 115: leaving the page while the delayed full-page load after closing the account is still waiting loads the page the member goes to in full (instead of dropping the load). Group 951: the Delete account dialog says payment records are kept 7 years (item 51). | After requesting an email change, the message says 'Check both your current and new email inboxes to complete the change.' Chosen version: 'Check your new email address to complete the change.' Otherwise the same look and steps. Group 27: on the Account tab, the red 'Delete account' row and its 'Delete' button are gone; under 'Sign out' one small grey line says 'To close your account, send us a data request.', with 'data request' linking to /dsar. Group 43, only once its switch is on (nothing changes while it is off): the red 'Delete account' row and its 'Delete' button are back as in the chosen version; the data request line is gone; the line under it reads 'Closes your account and erases your data, except records we must keep by law, such as payments, invoices and ID-check history. See our Privacy Policy.' instead of 'Removes your account and personal data for good.'. The dialog lists what happens (posts, the Terms' rule for slots, sign-in, the planned erasure and its waits, records kept by law) and has no 'Current password' field; without a password or Google sign-in from the last 15 minutes it says 'Your session needs a fresh sign-in. Sign in again'. After closing, the toast says 'Account closed' and the row reads 'Your account is closed. Erasure is planned for <date>.'; a lost answer says 'Account status unknown'; a session the database refuses (ended in another tab, or an unconfirmed address) says 'Sign in again' and why, without signing out. On phones the dialog sits at the bottom of the screen, clear of the site header, so its title shows. Group 74: Nothing (same data, same look) Group 97: Nothing (same redirect after the same delay). Group 107: the phone field is read-only with a 'Change number' button under it (or the existing 'Phone changes unlock on …' line); the province and city selects are always editable (no lock), with 'You can change your province and city once every 15 days.' under them once a place is confirmed; a change refused within 15 days shows 'You can change your province and city again after …'. Group 114: Delete account dialog: the slots line reads 'closing your account counts as a request to cancel all your slots and your Multi-listing package.' Group 115: Nothing (same look; the page left to is loaded in full) Group 951: in the Delete account dialog the line reads 'Payment records and invoices are kept for 7 years, as company and tax law require.' (was 'kept for 5 years for tax, as the law requires'). | keep                                             | approved by owner 2026-11-09 (best-practice wording); awaiting owner (group 27 hidden until it works); group 43 approved by owner 2026-11-19; group 74: approved by owner 2026-11-21; group 97 part awaiting owner; group 107 part approved by owner 2026-11-25 (answer: 'Approve them'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51; group 115 part approved by owner 2026-11-26; group 951 part approved by owner 2026-11-26 | 2026-11-26 | 89c2ba729a00 |
| `src/components/listings/content-lifecycle-button.tsx` | wording-behaviour | Sends revision and operation id; the confirm texts state the post lifecycle rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 'Mark sold' asks: 'Mark this item as sold? It leaves public view and is deleted in 3 days. Its slot stays in use until then; delete the post to free it sooner. You can undo this within the 3 days.' 'Deactivate' asks: 'Take this post offline? It keeps its slot, and its end date does not change.' Chosen version: the post frees the posting slot (and 'stays saved').                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep                                             | approved by owner 2026-11-09 (post lifecycle rules)                                                                                                                                                                                                                                                                                                                                          | 2026-11-09 | a831f4961fdf |
| `src/app/terms/page.tsx` | wording-behaviour | The Terms text used when the published posting terms cannot be read follows posting-v3. Live-test fix (group 35): names its canonical address (`/terms`). Group 66: An e-mail address is not a main action. Group 96: ECTA s43 details in 'Who we are', a 'Reporting a post' section and how to keep a copy. Group 95: the 'Reporting a post' section is removed again, because posting-v6 states the same rules in the Terms text. | Normally none: the page shows the current published terms ('Posting terms · posting-v3' once the database update is applied). Only when they cannot be read: header 'Updated November 2026' (was October) and the posting-v3 payment and visibility paragraphs. One terms step: the header reads 'Updated November 2026' and never names a terms version. Group 66: Terms: legal@verifymzansi.com is a green underlined text link with its envelope icon, instead of a filled green button; 'View Privacy Policy' unchanged. Group 96: Terms, 'Who we are' shows the owner's name once, in one row 'Director and Information Officer' (was 'Responsible officer' and 'Information Officer'), and gains Legal status, Address for legal notices ('Our registered address, as recorded at CIPC. Legal notices may also be sent by email to legal@verifymzansi.com; we confirm receipt.'), Phone, Email, Website and Dispute resolution code ('None yet. You can escalate a complaint to the National Consumer Commission.') rows, and the 'Registered address' row with the street address is removed; a new section 'Reporting a post' (Report button or abuse@verifymzansi.com, action within 2 business days, every report logged); 'Privacy & contact' adds that the Privacy Policy explains how we keep information secure, and 'To keep a copy of these Terms, use your browser's Print or Save as PDF.' Group 95: the 'Reporting a post' section and its navigation link are gone; the same rules (with group 96's wording on what to include in an email) are in the Terms text under 'Prohibited content' once posting-v6 is current. | keep | approved by owner 2026-11-09 (post lifecycle rules); one terms step part approved by owner 2026-11-12; group 66 part approved by owner 2026-11-20; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both') | 2026-11-24 | 9444c8691482 |
| `src/components/dashboard/introductory-trial-card.tsx` | wording-behaviour | The trial card states the post lifecycle rules and, with the new backend, shows the member's free week (M2.3). Retired-backend removal: browser client imported from the foundation module. Group 27: the retired-backend reading of free posts and trial claims is removed (it never ran: the dashboard always passes the free week), and with it the 'Your free posts' / 'Your free launch offer' variant that only that reading could show. 'Switch pending post to 7 days' joins 'Renew using my paid plan' behind one switch until they work. Group 57: 'Renew using my paid plan' and 'Switch pending post to 7 days' and their route (/api/trials) are removed, not hidden (row A18). Group 101: the card shows the claim's own length instead of a fixed 7 or 30. | Live trial: 'Visible until <date>. Then you have 3 days to reactivate it with a plan before it is deleted.' Chosen version: 'Your post stays saved.' (approved 2026-11-09). New (M2.3, awaiting owner): with the new backend the card appears again, in its existing slots, once the member's first post is submitted without a plan ('In review. The trial starts when approved.') and while the free week runs ('Your 7-day introductory trial', 'Visible until <date>'). Hidden until they work with the new backend: the 'Renew using my paid plan' button (its route is retired) and the card before the first post (its 'One free 7-day post or a 30-day launch trial' text is decided in M2.4). Pricing switch (group 17): 'One free 7-day post. Events are always free. No automatic charge.' (the 30-day launch trial is gone). Group 27: nothing visible changes (the 'Switch pending post to 7 days' button could not appear with the live backend's free week). Group 57: nothing (both were hidden). Group 101: nothing today (every claim is 7 days). | keep | approved by owner 2026-11-10 (M2.3 free week; lifecycle wording 2026-11-09); pricing switch part approved by owner 2026-11-12; retired-backend removal part awaiting owner; awaiting owner (group 27 hidden until it works); group 57 part awaiting owner; group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 1f1c700140ad |
| `src/components/dashboard/slot-usage-card.tsx`         | wording-behaviour | The posting slots card states the post lifecycle rules. Retired-backend removal: unused retired-backend parser removed. Group 93: names the new free credits source. | With no active plan: 'No active plan. Ended posts are deleted after 3 days — reactivate them from R50 / 30 days.' Chosen version: 'Your posts are saved — reactivate them from R50 / 30 days.' Pricing switch (group 17): 'No active plan. Ended posts are deleted after 3 days. Paid slots open soon.' (no R50 price). Group 93: a free credit shows 'Free credits from VerifyMzansi', with 'Never charged · All sections' under it instead of repeating the name. | keep                                             | approved by owner 2026-11-09 (post lifecycle rules); pricing switch part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 93 part awaiting owner | 2026-11-22 | 4b6a2a30d016 |
| `src/app/verification/page.tsx`                        | wording-behaviour | Upload receipts mapping; "Upload time not recorded" fallback; request id. With the new backend the page now receives the reviewer's reason for an ID that was sent back, in the fields it already shows (M2.7, BL-12). M6.2: 'Detect province and city' is hidden by its switch (owner rule 2; OD-07): its route used to always fail. Group 58: the route now works on the live backend and the switch's launch value is on, so the button returns at launch (that part awaiting owner). Phone codes (16 November 2026): when the server sends no code because the number is already verified on this account, is linked to another account, or may not be changed yet, the page no longer adds the delivery hint meant for a code that was sent. Phone bans (17 November 2026): a number blocked by a ban is also a case where no code was sent. Phone errors next to the field (17 November 2026, owner's request): a corner toast was easy to miss. Page view: group 46 (opening the page only reads the saved status). Group 69: camera only (no file fallback or file previews), names as on the ID, the ID photo check heading, Continue on your phone for the ID and selfie steps, and wording without 'upload'. Group 69 review: the page keeps the last phone code itself (gone with the page). Group 99: the ID step shows the independent check's states when the staff setting sends checks to Didit, the paused line on the camera route, and the independent wording of the side panels; on Manual it is unchanged. | No new element or style. When staff send an ID back, the step's existing message box shows the reviewer's explanation (for example 'Please retake your photo in even light without glare. ...') instead of the generic 'Your ID document was not accepted. Upload a clear photo showing the full document and all details.' The chosen version showed the reviewer's note in the same place. M6.2: the location step no longer shows the 'Detect province and city' button or the line 'Detection is approximate. You can also select your location manually.' Members pick their province and city from the list, as before. Group 58: from launch, the button and its line show again, as in the chosen version. Phone codes: after 'Failed to send code' for those reasons, only the message saying why shows; the grey line 'SMS delivery can take up to 60 seconds. If nothing arrives, confirm the number and resend once the timer ends.' no longer appears under the Send code button. Nothing else changes. Phone bans: after 'Failed to send code' with 'This phone number can't be used on VerifyMzansi. Contact support if you think this is a mistake.', the delivery hint does not show either. Phone errors: when a code cannot be sent or a code is wrong, the reason shows in red directly under the number or code field (the field gets a red outline; screen readers announce it) instead of a toast in the corner; it clears when the field is edited. 'Too many attempts' now says when to try again (for example 'Try again in 14 minutes.') and Send code stays disabled until then. Success toasts are unchanged. Group 69: the name labels and hint, 'Photo of your ID' with its line about the camera, 'Check your photo', the Continue on your phone panel, and 'Sending…', 'Your ID photo wasn't sent', 'Not taken yet'. | keep                                             | approved by owner 2026-11-12 (M2.7); M6.2 part approved by owner 2026-11-13; phone-code hint part approved by owner 2026-11-17 (asked to fix every gap found in the phone-code review); phone-ban part approved by owner 2026-11-17 (chose the neutral message); phone-error part approved by owner 2026-11-17 (asked for the message next to the number); group 69 part approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens); group 99 part approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures) | 2026-11-20 | eac6f491ef04 |
| `src/components/notification-bell.tsx`                 | wording-behaviour | Refreshes on REVALIDATE signal; account guard. The new backend adds a notice when staff send a member's ID back (M2.7, BL-12). Retired-backend removal: retired-backend branch removed. Live-test fix (group 35): shares one request and one once-a-minute refresh (not while hidden) with the other bell and listeners; was every 10 seconds per bell. Group 41: the backend adds notices for the account events that were email only, and for post moderation decisions, staff-issued invoices and restored posts (file unchanged).                                                                                                                                                                                                                                                                                                                                                                               | No new element or style. A member whose ID was sent back gets a notice in the existing list: 'Your ID check needs another look', 'Your ID was sent back. Open verification to see why and what to do next.', linking to the verification page. They also get an email saying only that the ID was sent back, with a link to sign in and see why. Group 41: the same list also shows 'Your ID check was accepted', payment, invoice, post moderation, restored post, post expiry and slot reminder notices (owner question 31).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | keep                                             | approved by owner 2026-11-12 (M2.7); retired-backend removal part awaiting owner; group 41 part awaiting owner                                                                                                                                                                                                                                                                               | 2026-11-10 | e816a020c390 |

### 3. Staff screens only

| File                                                               | Kind              | Reason                                                                                                                                                                                                                  | What changes on screen                                                                                                                                                                                                                                                                                                                                                               | Proposed | Owner decision                                            | Date       | Version      |
| ------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------- | ---------- | ------------ |
| `src/components/admin/evidence-decision-controls.tsx`              | wording-behaviour | Approve buttons name what the reviewer confirms; confirmed identity fields are sent with the decision.                                                                                                                  | Staff only: approve buttons read 'ID number and name match' and 'Selfie matches ID portrait'.                                                                                                                                                                                                                                                                                        | keep     | awaiting owner                                            | 2026-11-08 | b76ee7d3c2f9 |
| `src/components/admin/flagging-queue-table.tsx`                    | wording-behaviour | Follows the new backend's rule that another reviewer decides; double-submit guard.                                                                                                                                      | Staff only: 'Take action' is disabled with 'Awaiting an independent decision'.                                                                                                                                                                                                                                                                                                       | keep     | awaiting owner                                            | 2026-11-08 | 2d87d6376d20 |
| `src/components/admin/kyc-comparison-viewer.tsx`                   | wording-behaviour | ID review checklist follows the new backend's review steps. Retired-backend branch removed. Group 99: shows the 'Didit check' panel when the case had an automatic check. | Staff only: new checklist wording, PDF preview, the person's name in the title, 'Size available after loading'.                                                                                                                                                                                                                                                                      | keep     | awaiting owner; group 99 part approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures)                                            | 2026-11-08 | 4f19a4900606 |
| `src/components/admin/kyc-preview-lightbox.tsx`                    | wording-behaviour | Approval message comes from the shared review rules. A rejection or retake now asks for the note the server already requires (it was labelled optional, so an empty note was always refused).                           | Staff only: new approval message text; 'Available after loading' for file size. The notes box is labelled 'Note to the member *' (was 'Notes', placeholder 'Optional context...'); confirming a rejection without a note shows 'Please write a note telling the member what to fix.'                                                                                                 | keep     | approved by owner 2026-11-11 (ID rejection note required) | 2026-11-11 | dc742b6cefed |
| `src/components/admin/kyc-queue-table.tsx`                         | wording-behaviour | Approval dialog follows the new backend's review rules. A rejection or retake now asks for the note the server already requires (it was labelled optional, so an empty note was always refused). Claim first: group 39. | Staff only: the approval dialog says high-risk cases need a second reviewer. The notes box is labelled 'Note to the member *' (was 'Additional notes', placeholder 'Optional: provide additional context...'); confirming a rejection without a note shows 'Please write a note telling the member what to fix.' 'View documents' and 'View' wait for the viewer's claim (group 39). | keep     | approved by owner 2026-11-11 (ID rejection note required) | 2026-11-11 | f40c0fb40351 |
| `src/components/admin/queue-claims.tsx`                            | wording-behaviour | The new backend always needs a claim before a reviewer acts. Retired-backend branch removed.                                                                                                                            | Staff only: an item must be claimed before acting; ID-check claims are shown as 30 minutes.                                                                                                                                                                                                                                                                                          | keep     | awaiting owner                                            | 2026-11-08 | b176f6496249 |
| `src/components/admin/use-content-decision.ts`                     | wording-behaviour | The new backend refuses decisions on unclaimed items; in-flight guard. Retired-backend branch removed.                                                                                                                  | Staff only: 'Claim this item and reload the queue' when deciding an unclaimed item.                                                                                                                                                                                                                                                                                                  | keep     | awaiting owner                                            | 2026-11-08 | 692561ecf20a |
| `src/app/admin/dsar/dsar-case-controls.tsx`                        | wording-behaviour | Export needs a verified access request on the new backend.                                                                                                                                                              | Staff only: export is disabled until a verified access request exists, with a tooltip.                                                                                                                                                                                                                                                                                               | keep     | awaiting owner                                            | 2026-11-08 | 27c027ae4c48 |
| `src/app/admin/dsar/page.tsx`                                      | wording-behaviour | Privacy request queue reads from the new backend. Retired-backend branch removed. Group 78: the Export button is offered only for a verified access request in progress; a completed request can no longer be exported, so the button stopped working there. | Staff only: request actions are shown only to staff allowed to process them. Group 78: staff only: on a completed access request the Export JSON button is greyed out (as on other requests that cannot be exported) instead of clickable and always refused. | keep     | awaiting owner; group 78 part approved by owner 2026-11-21 | 2026-11-21 | d2107d53ca44 |
| `src/app/admin/governance/appeals/[id]/appeal-resolve-form.tsx`    | wording-behaviour | Offers only the outcomes the new backend accepts.                                                                                                                                                                       | Staff only: 'Partially overturned' appears only when a suspension can be shortened; new placeholder.                                                                                                                                                                                                                                                                                 | keep     | awaiting owner                                            | 2026-11-08 | fbf5c869e91f |
| `src/app/admin/governance/appeals/[id]/page.tsx`                   | wording-behaviour | Appeal page reads from the new backend. Retired-backend branch removed.                                                                                                                                                 | Staff only: new 'requires another reviewer' message when the appeal cannot be resolved by this person.                                                                                                                                                                                                                                                                               | keep     | awaiting owner                                            | 2026-11-08 | 65c0f2d9bbad |
| `src/app/admin/governance/enforcement/lift-restriction-button.tsx` | wording-behaviour | Follows the new backend's limits.                                                                                                                                                                                       | Staff only: the reason is limited to 500 characters; error messages reworded.                                                                                                                                                                                                                                                                                                        | keep     | awaiting owner                                            | 2026-11-08 | 2e653233b0b4 |
| `src/app/admin/governance/enforcement/page.tsx`                    | wording-behaviour | Enforcement list reads from the new backend. Retired-backend branch removed. Group 54: a restricted member is named by their short name, with the account reference beside it. Group 110: adds the 'Blocked phone numbers' card. | Staff only: new 'requires review through its decision' message. Group 54: Staff only: a restricted member shows as 'Thandeka D. · 1a2b3c4d…' (short name and account reference) instead of the full name. Group 110: Staff with account:restore: the 'Blocked phone numbers' card (see group 110). | keep     | awaiting owner; group 54 part awaiting owner; group 110 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-19 | d4fd3b202a99 |

### 4. Rewiring only (no visible change)

| File                                                                          | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Proposed | Owner decision                                                                                                                                                                                                                                                                                                              | Date       | Version      |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/components/admin/activity-feed.tsx`                                      | rewiring          | Actor id may be null; shows "System" instead of crashing on `slice`. Group 98: the five add-on purchase labels are removed (never recorded; an unknown event shows its own name). | Nothing (same look and steps) Group 98: Staff activity feed: no add-on purchase labels. | keep     | awaiting owner; group 98 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 144f8f2a9837 |
| `src/components/admin/area-admin-tabs.tsx`                                    | rewiring          | Uses shared `ReportItem` type; nullable actor id.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 881a44450aea |
| `src/components/admin/commercial/commercial-action.tsx`                       | rewiring          | Step-up (MFA) refusals now route to the existing `/staff/two-step` page. P2b: a form may word its success message from the reply (a bank transfer already recorded says so instead of 'recorded').                                                                                                                                                                                                                                                                                          | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | c6a5409054b3 |
| `src/components/admin/commercial/organisation-forms.tsx`                      | rewiring          | Sends `revision` for conflict-safe saves.                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 43e9abfd1798 |
| `src/components/admin/commercial/organisation-invites.tsx`                    | rewiring          | Drops unused `created_at` from the type.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | c0157b669c9a |
| `src/components/admin/evidence-desk.tsx`                                      | rewiring          | Merges file type/size learned after download; `&` to `&amp;` (renders the same).                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 856ea784af57 |
| `src/components/admin/evidence-metadata-panel.tsx`                            | rewiring          | Null-safe size; "Not returned" when the storage key is withheld.                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 1b93f935c4e6 |
| `src/components/admin/evidence-types.ts`                                      | rewiring          | Types: nullable key/size, native evidence fields.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 297912ffa0ff |
| `src/components/admin/evidence-viewer.tsx`                                    | rewiring          | Native evidence request body, abortable fetch, retry via effect.                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 8a7e80979991 |
| `src/components/admin/kyc-inline-preview.tsx`                                 | rewiring          | Loads evidence only with a claim scope in foundation mode. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                  | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | c0ed76d2695f |
| `src/components/admin/moderation/moderation-preview-panel.tsx`                | rewiring          | Adds foundation review type; `&amp;` entity. Group 86 (SHOW_POST_COPY): a claimed copy shows where it was copied from. Group 113: shows each video's stored length and the post kind's limit (kept out of the edit's changed fields). | Nothing (same look and steps) Group 86 (staff, switch on): under the quality summary of a claimed listing, 'Copied from <title> (status)' (a link only when that post is live; 'a post that has since been deleted' once it is gone). Group 113 (staff): under the photos and video of a claimed post with a video, 'Video length: 1 min 35 s (limit 2 minutes)' (events: 'limit 1 minute'; 'not recorded' when the length was never stored). | keep     | awaiting owner; group 86 part approved by owner 2026-11-22; group 113 part approved by owner 2026-11-26 | 2026-11-21 | c88581f781f8 |
| `src/components/admin/role-assign-form.tsx`                                   | rewiring          | Fallback verify URL when none returned.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 263370c0eb0c |
| `src/components/admin/role-change-review-actions.tsx`                         | rewiring          | Network-failure handling; fallback verify URL; error text reworded.                                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 8bbc9d0bf1ae |
| `src/components/dashboard/leads-feed.tsx`                                     | rewiring          | Realtime REVALIDATE reloads `/api/leads`; uses `target_href`; uncertain-update message. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                     | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 54c15412c95d |
| `src/components/dashboard/suspension-notice.tsx`                              | rewiring          | Accepts a server-confirmed `confirmedUntil` date.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 05f3142c8279 |
| `src/components/home/home-business-showcase.tsx`                              | rewiring          | Foundation reads `restoredHomeCollection("businesses")`; M4.1 video flag. M10.3: with no businesses the rail collapses into one card. Retired-backend removal: retired-backend branch removed. Stub fixture-hiding filter removed.                                                                                                                                                                                                                                                          | M4.1: a business with a cover video shows the video tile, as in the chosen version. M10.3: with no businesses, one 'Be the first to add a business' card replaces the rail (see `home-showcase-empty-state.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | awaiting owner (earlier change); M4.1 part approved by owner 2026-11-12; M10.3 part approved by owner 2026-11-12; retired-backend removal part awaiting owner                                                                                                                                                               | 2026-11-12 | 0bf4bd4a72b0 |
| `src/components/home/home-mzansi-market-showcase.tsx`                         | rewiring          | Foundation reads `restoredHomeCollection("listings")`; M4.1 video flag. M10.2: passes the post's price mode so a free item says 'Free'. M10.3: with no listings the rail collapses into one card. Retired-backend removal: retired-backend branch removed. Stub fixture-hiding filter removed.                                                                                                                                                                                              | M4.1: a listing with a video shows the video tile, as in the chosen version. M10.2: a free item's card says 'Free' (see `market-preview-card.tsx`). M10.3: with no listings, one 'Be the first to sell on Mzansi Market' card replaces the rail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | keep     | awaiting owner (earlier change); M4.1 part approved by owner 2026-11-12; M10.2 and M10.3 parts approved by owner 2026-11-12; retired-backend removal part awaiting owner                                                                                                                                                    | 2026-11-12 | 277736207f5a |
| `src/components/home/home-programme-showcase.tsx`                             | rewiring          | Foundation reads `restoredProgrammeShowcases` (logo not supplied). M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). Retired-backend removal: retired-backend branch removed.                                                                                                                                                                                                                                                         | M10.2: home 'Sponsor spotlight' label in sentence case, normal letter spacing; same size, colour and icon.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | keep     | awaiting owner; M10.2 part approved by owner 2026-11-12; retired-backend removal part awaiting owner                                                                                                                                                                                                                        | 2026-11-12 | 958bf265714e |
| `src/components/home/home-promotions-showcase.tsx`                            | rewiring          | Foundation reads promotions and tourism businesses collections; M4.1 video flag. M10.3: with no stays or events the rail collapses into one card. Retired-backend removal: retired-backend branch removed. Stub fixture-hiding filter removed.                                                                                                                                                                                                                                              | M4.1: an event or place with a video shows the video tile, as in the chosen version. M10.3: with no stays or events, one 'Be the first to list a stay or event' card replaces the rail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | awaiting owner (earlier change); M4.1 part approved by owner 2026-11-12; M10.3 part approved by owner 2026-11-12; retired-backend removal part awaiting owner                                                                                                                                                               | 2026-11-12 | 0ee1294df992 |
| `src/components/listings/delete-post-button.tsx`                              | rewiring          | Sends revision and operation id.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 01594d3a00bb |
| `src/components/listings/resubmit-button.tsx`                                 | rewiring          | Sends revision and operation id. Group 114: when resubmitting waits for the current posting terms, the error links to the post's Edit page, where they are accepted. | Nothing (same look and steps) Group 114: My posts, a rejected post, Resubmit refused for the posting terms: after 'Review and accept the current posting terms before continuing' a link 'Open Edit to accept them' opens that post's Edit page. Other refusals look the same. | keep     | awaiting owner; group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 39696d7ebff5 |
| `src/components/notifications/use-live-notification-listener.tsx`             | rewiring          | Foundation REVALIDATE fetch; stricter link validation. Retired-backend branch removed. Live-test fix (group 35): reads through the shared inbox request.                                                                                                                                                                                                                                                                                                                                    | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | e7cbb6fac0c4 |
| `src/components/search/search-start.tsx`                                      | rewiring          | `&amp;` entity only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 5c548220f57b |
| `src/components/search/site-search.tsx`                                       | rewiring          | `&amp;` entity only. Group 54: search pages stop at page 100. | Nothing (same look and steps) Group 54: page links stop at page 100; on the last page, when there are more results, 'Showing the first N results. Narrow your search to see more.' (N = 100 pages of results); a deeper page address shows page 100. Search: 12 a page, so 'Showing the first 1 200 results.' | keep     | awaiting owner; group 54 part awaiting owner | 2026-11-19 | ff70c027c7ea |
| `src/hooks/use-auth.ts`                                                       | rewiring          | Foundation account session mapped to the restored profile shape. Fix: the header name falls back to the Google sign-in name (or the address) until a profile name is saved, and staff keep their role in the menu before this session's two-step check (logic in `src/lib/auth/session-display.ts`). Retired-backend removal: retired-backend branch removed. Browser client imported from the foundation module; stub session cookie check removed. Group 68: a code comment no longer names the removed server sign-out route; the cookie clearing is unchanged.                                        | Signed-in members who have not saved a name see their Google name's initials instead of 'U'. Staff see the 'Admin' menu item right after signing in; it opens the two-step page first, as before. Group 68: Nothing on screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | awaiting owner (header name and staff link fix, 2026-11-12); group 68 part approved by owner 2026-11-20                                                                                                                                                                                                                                                                 | 2026-11-20 | 6c69debaffab |
| `src/hooks/use-leads-unread.ts`                                               | rewiring          | Ignores counts for another account. Browser client imported from the foundation module; owner column fixed to owner_id. Live-test fix (group 35): reads the lead count through the shared inbox request.                                                                                                                                                                                                                                                                                    | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | 44336ca5df6a |
| `src/hooks/use-post-draft-autosave.ts`                                        | rewiring          | Sends `X-Draft-Account` header.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | ed31dac8ee57 |
| `src/hooks/use-realtime.ts`                                                   | rewiring          | Foundation leads/notifications use a private inbox channel that signals REVALIDATE. Retired-backend branch removed. Browser client imported from the foundation module.                                                                                                                                                                                                                                                                                                                     | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | 9fccceb17b86 |
| `src/app/(marketplace)/_lib/promotion-detail-page-content.tsx`                | rewiring          | Foundation event detail, public seller facts and the host business from public reads. Retired-backend branch removed. Group 61: the full-screen viewer gets the event's real like total (was always 0). Group 68: the old client's signed-in check is removed. It only decided whether the poster gets their own number in the page, and that number is never sent (always empty), so the public page reads no session. | The host business card shows on event pages linked to a live business, as in the chosen version Group 61 (only while the counters are shown): the viewer's like count is the real total. Group 68: Nothing on screen. | keep     | awaiting owner; group 61 part awaiting owner; group 68 part approved by owner 2026-11-20 | 2026-11-20 | 147152ef99e0 |
| `src/app/(marketplace)/mzansi-business/_lib/business-detail-page-content.tsx` | rewiring          | Foundation business detail and affiliations. Retired-backend branch removed. Group 61: the full-screen viewer gets the business's real like total (was always 0). Group 85: reads the storefront (api.get_public_storefront) and its first page of stock; with one that has live listings, renders 'All stock', hides 'Live offers' and keeps the classic page on desktop. | Nothing (same look and steps) Group 61 (only while the counters are shown): the viewer's like count is the real total. Group 85 (switch on, checked business with a running package): 'All stock' below the business; desktop opens the business page itself instead of the post viewer. | keep     | awaiting owner; group 61 part awaiting owner; group 85 part approved by owner 2026-11-21 | 2026-11-21 | b619ec8258f9 |
| `src/app/admin/_lib/area-admin-page.tsx`                                      | rewiring          | Step-up redirect; claim case id.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | f02e9ce93231 |
| `src/app/admin/audit-log/page.tsx`                                            | rewiring          | Query moved to `readStaffAuditPage` service.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 4ac1e8418798 |
| `src/app/admin/business-verification/[id]/page.tsx`                           | rewiring          | Native Seen/CIPC case; several CIPC detail fields are null in foundation. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                   | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 3a6ba2e658cd |
| `src/app/admin/business-verification/page.tsx`                                | rewiring          | Native Seen queue. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 3134f7fac977 |
| `src/app/admin/dsar/dsar-action-buttons.tsx`                                  | rewiring          | Sends revision; step-up redirect.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 6bbecef653f2 |
| `src/app/admin/feature-flags/feature-flags-client.tsx`                        | rewiring          | Refactor; sends revision; same toasts. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 87a31d619382 |
| `src/app/admin/feature-flags/page.tsx`                                        | rewiring          | Remounts per staff user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 9f1f313eab40 |
| `src/app/admin/governance/appeals/page.tsx`                                   | rewiring          | Native appeals; total badge; step-up redirect. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | ff7e0f4032af |
| `src/app/admin/governance/escalations/[id]/decision-action-buttons.tsx`       | rewiring          | Foundation scope; double-submit guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 2797b6010773 |
| `src/app/admin/governance/escalations/[id]/page.tsx`                          | rewiring          | Reads through `readGovernanceRecord`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 441577b0d959 |
| `src/app/admin/governance/oversight/page.tsx`                                 | rewiring          | Reads through `readGovernanceMetrics`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 027a302abcb8 |
| `src/app/admin/governance/roles/page.tsx`                                     | rewiring          | Native roster; "Former staff member" fallback. Retired-backend branch removed. Group 106: the header line now says removing an admin needs another admin's approval.                                                                                                                                                                                                                                                                                                                                                                                                              | Group 106: the header line reads 'Promotions need an independent approver. Removing an admin needs another admin's approval.' (was '... Removals by an admin take effect immediately.'). Otherwise the same look and steps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner; group 106 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-08 | fcc9b37a34a5 |
| `src/app/admin/layout.tsx` | rewiring | Navigation filtered by assigned capabilities; flag context. Group 72: mounts the staff two-step return (a staff action refused for an expired authenticator check goes to the two-step page and back). | Nothing (same look and steps) | keep | awaiting owner; group 72 part approved by owner 2026-11-21 | 2026-11-20 | 10cd80ed01cd |
| `src/app/admin/moderation/page.tsx`                                           | rewiring          | Native moderation queue; 403 goes to two-step. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                              | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 34d98b08b2f6 |
| `src/app/admin/organisations/page.tsx`                                        | rewiring          | Native directory. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 3b2dd161adcf |
| `src/app/admin/partners/page.tsx`                                             | rewiring          | Native partner admin. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 813d25887ba5 |
| `src/app/admin/reports/page.tsx`                                              | rewiring          | Native report queue.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | b83a19911004 |
| `src/app/admin/reports/reports-client.tsx`                                    | rewiring          | Type only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | ec4bde2bfa49 |
| `src/app/admin/support/page.tsx`                                              | rewiring          | Native support inbox. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | ffc354428ef6 |
| `src/app/admin/support/support-inbox-client.tsx`                              | rewiring          | Sends revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | d8b163c733a8 |
| `src/app/admin/verification/evidence/page.tsx`                                | rewiring          | Flag context; remount per user.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 9dfa21d07dac |
| `src/app/admin/verification/page.tsx`                                         | rewiring          | Flag context; claim case id. Group 99: reads the ID check setting and shows the 'ID checks' card above the queue. | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner; group 99 part approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures)                                                                                                                                                                                                                                                                                                              | 2026-11-08 | f8e66ef32106 |
| `src/app/banned/page.tsx`                                                     | rewiring          | Foundation restriction read. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 67d63ca40b81 |
| `src/app/billing/checkout/page.tsx`                                           | rewiring          | Foundation checkout summary; a failed summary read is now logged (M5.1). Retired-backend removal: retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps) Pricing switch (group 17): tells the confirmation page when no plan is on sale (its note is in checkout-confirm.tsx). R69 slots (group 18): reads the member's Individual slots (ID review, slots held, limit) so the page offers only what can be bought. Renew early (group 32): a renewal link (`?renew=` a slot, `all` or `soon` for the reminder's 'Renew all'; without a term the 30-day one) reads the member's slots and hands the slots that can be renewed, each with the date its new days start, to the confirmation page (its wording is in checkout-confirm.tsx). Invoice choice: group 36.                                                                                                                                                                                                                                                                                                                                                                      | keep     | awaiting owner (earlier change); M5.1 part approved by owner 2026-11-12; pricing switch part approved by owner 2026-11-12; R69 slots part approved by owner 2026-11-12 (pricing switch); retired-backend removal part awaiting owner; renew early part approved by owner 2026-11-14                                         | 2026-11-17 | deae8c395660 |
| `src/app/dashboard/affiliations/page.tsx`                                     | rewiring          | Native affiliation workspace. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                               | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | b8d71550fc03 |
| `src/app/dashboard/leads/page.tsx`                                            | rewiring          | Native enquiries. Retired-backend branch removed. Group 68: the signed-in check reads the account the sign-in gate verified (live backend) instead of the old client.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps) Group 68: Nothing on screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner; group 68 part approved by owner 2026-11-20                                                                                                                                                                                                                                                                                                              | 2026-11-20 | bebdf57d36a9 |
| `src/app/dashboard/partner/page.tsx` | rewiring | Native partner dashboard. Retired-backend branch removed. Group 80: with SHOW_PARTNER_PAGE on, a partner gets the redesigned page (partner-overview.tsx); the summary's type moved to src/lib/partners/partner-overview.ts and the recent commission list moved, unchanged, into partner-overview.tsx so both pages share it. With the switch off, the page is unchanged. Group 90: the referral line no longer states the commission percentage or the 30 days ('A share of each qualifying payment. Commission is pending for a waiting period, then approved if the payment stands.'), by the owner's decision of 22 November 2026. | Nothing (same look and steps) Group 80: nothing today (switch off). Once on, a partner sees the redesigned page described in group 80; someone who is not a partner sees today's page. | keep | awaiting owner; group 80 part approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-21 | a8809df5265c |
| `src/app/layout.tsx`                                                          | rewiring          | `&amp;` entity in the no-JavaScript notice. M10.3: the 'Launching soon' pop-up is removed (owner decision OD-15). Retired-backend removal: stub browser suite session cookie check removed from the signed-in shell hint. Launching soon pop-up returned to the 27 Oct baseline at owner's request; reverses part of group 12: the pop-up and its switch are back, on, and still left out of Playwright runs. Owner decision 18 November 2026: only the pop-up comes back; the slim be-the-first cards and the slim Every poster ID-reviewed line of group 12 stay. | M10.3: no 'We're launching soon' pop-up over the first page a visitor opens. Launching soon pop-up (returned to the 27 Oct baseline at owner's request; reverses part of group 12): the 'We're launching soon' pop-up shows again over the first page a visitor opens, as in the chosen version. | keep     | awaiting owner; M10.3 part approved by owner 2026-11-12; retired-backend removal part awaiting owner; launching soon pop-up part: returned to the 27 Oct baseline at owner's request; reverses part of group 12 | 2026-11-18 | 0ea8baf43ace |
| `src/app/listing/[id]/page.tsx`                                               | rewiring          | Foundation listing detail; similar posts from collection read. Retired-backend branch removed. Group 61: the full-screen viewer gets the listing's real like total (was always 0). Group 68: the old client's signed-in check is removed. It only decided whether the poster gets their own number in the page, and that number is never sent (always empty), so the public page reads no session. Group 85: a listing in a storefront passes its business (name, CIPC date, 'See all N cars') to the seller block, the desktop viewer's seller card and the page's structured data. | Nothing (same look and steps) Group 61 (only while the counters are shown): the viewer's like count is the real total. Group 68: Nothing on screen. Group 85 (switch on, listing in a storefront): the seller block shows the business, its stickers and 'See all 18 cars'; the desktop viewer's seller card names the business and opens its page. | keep     | awaiting owner; group 61 part awaiting owner; group 68 part approved by owner 2026-11-20; group 85 part approved by owner 2026-11-21 | 2026-11-21 | 65c981998783 |
| `src/app/organisation-invite/page.tsx`                                        | rewiring          | Native invite preview. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-08 | 126caa3e74c3 |
| `src/app/organisation/[slug]/page.tsx`                                        | rewiring          | Native organisation page; fixed "Supported by" wording. M9.4: drops `revalidate = 300`, which did nothing (every page renders per request). M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). Retired-backend removal: retired-backend branch removed. Group 119: the programme filter is sent to the database by its id. | M10.2: the gold label above the organisation's name ('Business Sponsor · ...') in sentence case, normal letter spacing; same size and colour. Group 119: nothing (the list loads in one database read; a programme is matched by its id, not its name). | keep     | awaiting owner (earlier change); M9.4 part approved by owner 2026-11-12; M10.2 part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 119 part awaiting owner | 2026-11-26 | 0b817c926b9b |
| `src/app/page.tsx`                                                            | rewiring          | `&amp;` entity in screen-reader heading. M9.4: drops `revalidate = 60`: every page renders per request (the layout reads request headers), so it did nothing. M10.3: adds the slim identity line under the showroom. Live-test fix (group 35): names its canonical address (`/`).                                                                                                                                                                                                           | M10.3: the line 'Every poster ID-reviewed · What we check' under the showroom (see `home-identity-line.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner (earlier change); M9.4 part approved by owner 2026-11-12; M10.3 part approved by owner 2026-11-12                                                                                                                                                                                                            | 2026-11-12 | ce6e10155072 |
| `src/app/post/create-business/page.tsx`                                       | rewiring          | Adds hidden posting transport fields. M4.4a (group 30): the video field states the length rule and checks it again at submit. M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 115: uses the shared posting-terms tick (same blue colours and wording) instead of its own copy. Group 125: submits and checks the service areas typed under customer access (a stale copy was sent before); server errors open the step that shows the field. | Nothing (same look and steps) M4.4a (group 30): Business create form: the video field's help text adds 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 115: Nothing (same words, colours and place) Group 125: Create business: a business that travels to customers can submit (it was refused with 'Service Areas.areas: Add at least one service area'); a server error names its real step, for example 'Step 2 - Location & customer access', and the field's label. | keep     | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 115 part approved by owner 2026-11-26; group 125 part awaiting owner | 2026-11-27 | 10e898029250 |
| `src/app/post/create-listing/page.tsx` | rewiring | Adds hidden posting transport fields. M4.4a (group 30): the video field states the length rule and checks it again at submit. M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 86 (SHOW_POST_COPY): opened with ?copy=<id> the form loads the copy (a server draft), opens on step 3 and saves it with the edit route, then submits it for review; it never reads or writes the form's autosaved draft. Group 87 (SHOW_POST_TEMPLATES): opened with ?template=<id> the form fills in the template's fields once and does not restore an older autosaved draft over it. Group 87 (review): one start step settles the template, else the autosaved draft; a template that replaced a draft offers Undo. Group 87 (delta review): untouched template fields are not autosaved and the Undo offer stays until the first change through the form; the form waits while a template loads; a kept page opened again with a template sets aside the work in it (title, price, photos and video cleared; Undo brings them back). Group 87 (second delta review): the member's area fills in with the template instead of as a later edit; leaving the form closes the Undo message; on a first visit Undo brings back the draft as stored at that moment. Group 87 with group 86: a copy (?copy=<id>) never starts from a template. Group 95: the posting-terms tick is the shared PostingTermsConsent component (same markup and words). Group 115: the form is keyed on the copy it was opened with, so a kept page never mixes a copy with the ordinary form or a template; a copy accepts the terms before its uploads. Group 125: server errors open the step that shows the field (step-mapping lines only). | Nothing (same look and steps) M4.4a (group 30): Market create form: the video field's help text adds 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 86 (only when opened on a copy): the note 'Copy of "<title>". Everything except the video is filled in...' under the heading; the copy's photos and logo shown as already uploaded; 'Video not copied. Add this item's own video below if you have one.' above the video; a vehicle or property copy sent without a new photo is refused by the server and the form shows 'Add at least one new photo of this item. Each car or home is a different item.' on the photo step, and can be sent again; in Final check the hint 'Same title as the post you copied...' while the title is unchanged and 'Copies are checked like any new post and count towards your new posts allowance.'; the posting-terms tick only when the current terms are not accepted yet (the acceptance is recorded before the save); no 'Draft saved' line. Group 87 (switch on): after Use on a template, the form opens filled in (category, details, description, location, contact buttons) with the message 'Started from "<name>"'; the poster adds photos, title, price, year and mileage. Group 87: when a template replaced an unfinished post, its message offers Undo, which brings that post back (until the first edit). Group 87: "Loading your template…" while a template loads (at most 5 seconds). Group 95: nothing changes on screen (the tick is drawn by a shared component with the same markup and words). Group 115: Nothing (same look and steps) Group 125: Create listing: a server error for price, place, contact or media names that step instead of Step 1. | keep | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 86 part approved by owner 2026-11-22; group 87 part approved by owner 2026-11-22; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26; group 125 part awaiting owner | 2026-11-27 | c8f5e867fa78 |
| `src/app/post/create-tourism/page.tsx`                                        | rewiring          | Adds hidden posting transport fields. M4.4a (group 30): the video field states the length rule and checks it again at submit (events 1 minute, tourism businesses 2 minutes). M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 115: uses the shared posting-terms tick (same teal colours and wording) instead of its own copy. Group 125: server errors open the step that shows the field. | Nothing (same look and steps) M4.4a (group 30): Tourism & Events create form: the video field's help text adds 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'; an event's video over 1 minute is refused at submit. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 115: Nothing (same words, colours and place) Group 125: Create tourism: a server error names the step that shows the field (for example a logo or video cover error names Step 4) instead of Step 1. | keep     | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 115 part approved by owner 2026-11-26; group 125 part awaiting owner | 2026-11-27 | 8e2cc2edecf5 |
| `src/app/post/edit-business/[id]/page.tsx` | rewiring | Owner read `?owner=1`; revision capture. M4.4a (group 30): the video field states the length rule and checks it again at submit. M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 95: after a Terms change, the edit form asks for the current posting terms and accepts them before saving. Group 115: accepts the posting terms before uploading new media. Group 125: saves the service areas typed under customer access (a stale copy loaded with the page was sent before). | Nothing (same look and steps) M4.4a (group 30): business profile video (edit form): the video field's help text replaces 'Max 50 MB.' with 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 95: while the member has not accepted the current posting terms (after a Terms change), the edit form shows the same posting-terms tick as Create listing above Save changes; saving without it shows 'Accept the posting terms before submitting.', and with it the terms are accepted before the changes are saved. Members who already accepted see no change. Group 115: Nothing (same look and steps) Group 125: Edit business: service areas typed or changed under 'I travel to customers' are saved. | keep | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26; group 125 part awaiting owner | 2026-11-27 | 3b32673657c9 |
| `src/app/post/edit-listing/[id]/page.tsx` | rewiring | Revision capture; transport fields. Browser client imported from the foundation module. M4.4a (group 30): the video field states the length rule and checks it again at submit. M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 87 (SHOW_POST_TEMPLATES): a 'Save as template' button beside the Mzansi Market label, for a member whose Multi-listing package runs. Group 95: after a Terms change, the edit form asks for the current posting terms and accepts them before saving. Group 115: accepts the posting terms before uploading new photos or video, so a failed acceptance leaves no uploaded files behind. | Nothing (same look and steps) M4.4a (group 30): Market edit form: the video field's help text adds 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 87 (switch on, running package): 'Save as template' at the top of the form opens the naming dialog (picture bt-09). Group 95: while the member has not accepted the current posting terms (after a Terms change), the edit form shows the same posting-terms tick as Create listing above Save changes; saving without it shows 'Accept the posting terms before submitting.', and with it the terms are accepted before the changes are saved. Members who already accepted see no change. Group 115: Nothing (same look and steps) | keep | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 87 part approved by owner 2026-11-22; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26 | 2026-11-26 | 23b68760edd0 |
| `src/app/post/edit-tourism/[id]/page.tsx` | rewiring | Owner read; revision capture; `&amp;` entities. M4.4a (group 30): the video field states the length rule and checks it again at submit (events 1 minute, tourism businesses 2 minutes). M10.7 (group 59): the video field's help text adds one tip for viewers who watch without sound. Group 95: after a Terms change, the edit form asks for the current posting terms and accepts them before saving. Group 115: accepts the posting terms before uploading new media. | Nothing (same look and steps) M4.4a (group 30): event edit form: the video field's help text adds 'Up to 2 minutes (events: 1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds — put the best part first.'; a video over 1 minute is refused. M10.7 (group 59): after the length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.' Group 95: while the member has not accepted the current posting terms (after a Terms change), the edit form shows the same posting-terms tick as Create listing above Save changes; saving without it shows 'Accept the posting terms before submitting.', and with it the terms are accepted before the changes are saved. Members who already accepted see no change. Group 115: Nothing (same look and steps) | keep | awaiting owner; M4.4a part awaiting owner; group 59 part approved by owner 2026-11-20; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26 | 2026-11-26 | e96fa2511238 |
| `src/app/pricing/multi-listing/page.tsx`                                      | rewiring          | `&amp;` entity only. M9.4: drops `revalidate = 300`, which did nothing (every page renders per request). P4a (group 33): the words and numbers follow the owner's package rules of 14 November 2026 (decision 14), and the page reads the sales switch from the live backend instead of the retired one. Group 40: package teams are not built yet (P4c), so the team point is hidden (owner rule 2); the link to Advertise's Multi-listing section shows only while that section is shown. Group 90: always shown (no visible link leads to a 404); buying still needs the database's packages sales switch. | Nothing (same look and steps) Pricing switch (group 17): the page answers 'not found' while multi-listing is not on sale. P4a (group 33): still not found while packages are not on sale (the database switch, off). Once on sale: 'One package, many posts.'; 'From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days, ...'; the points 'Does not renew automatically', 'Secure Ozow checkout', 'You + 1 person (you + 4 from 50 slots)'; 'Choose your package' with the new sizes; the three steps reworded (typed slots, 4 posts going live per slot per 30 days, all slots end together). Gone: '10 to 100 posts', '90 or 180 days', old prices, 'Paid once, never renews', '2 administrators included'. Group 35: shows Ozow's maximum. Group 40: no 'You + 1 person (you + 4 from 50 slots)' point, and no 'Who multi-listing is for, and everything it includes' link while Advertise hides its Multi-listing section (the page itself is still not found while packages are not on sale). | keep     | awaiting owner (earlier change); M9.4 part approved by owner 2026-11-12; pricing switch part approved by owner 2026-11-12; P4a part (group 33) approved by owner 2026-11-16 (its team wording is a follow-up before sales go on); invoice choice (group 36) approved 2026-11-17; group 40 part approved by owner 2026-11-17; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-17 | d0cbf3841a8f |
| `src/app/api/share-preview/[type]/[id]/route.tsx`                             | rewiring          | Reads the post through the foundation adapter; the retired read made every link 404. M9.9: the same card is drawn by the offload Worker (design moved unchanged to `src/lib/sharing/share-card.tsx`).                                                                                                                                                                                                                                                                                       | Nothing on the site; shared post links show their preview card again                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | keep     | approved by owner 2026-11-12 (M6.4)                                                                                                                                                                                                                                                                                         | 2026-11-13 | c9f5d059789d |
| `src/components/organisations/business-affiliations-section.tsx`              | rewiring          | Unused retired-backend affiliation loader removed.                                                                                                                                                                                                                                                                                                                                                                                                                                          | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | 355651486372 |
| `src/app/dashboard/complete-profile/page.tsx`                                 | wording-behaviour | Browser client imported from the foundation module (`restored-browser-client`) instead of `@/lib/supabase/client`, which only re-exported it. Phone errors next to the field (17 November 2026, owner's request): a corner toast was easy to miss. Group 75: the profile is read through the named own-profile read (`readRestoredOwnProfile`) instead of an old table-style call naming the table through a code constant, which the browser client translated into the same read. Group 107: change mode (?change=1) keeps a member with a verified number on the step to verify a new one. | Phone errors: when a code cannot be sent or a code is wrong, the reason shows in red directly under the number or code field (the field gets a red outline; screen readers announce it) instead of a toast in the corner; it clears when the field is edited. 'Too many attempts' now says when to try again (for example 'Try again in 14 minutes.') and Send code stays disabled until then. Success toasts are unchanged. Group 75: Nothing (pixel-identical, no visible change) Group 107: in change mode the title reads 'Change your phone number', the line under it 'We send a 6-digit code by SMS to your new number. Your current number stays until the new one is verified.', the card 'Your new mobile number', the breadcrumb 'Change phone', and the number field starts empty. | keep     | awaiting owner; phone-error part approved by owner 2026-11-17 (asked for the message next to the number) ; group 75: approved by owner 2026-11-21; group 107 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-21 | 320887f2b93f |
| `src/app/staff/two-step/two-step-client.tsx`                                  | rewiring          | Browser client imported from the foundation module (`restored-browser-client`) instead of `@/lib/supabase/client`, which only re-exported it.                                                                                                                                                                                                                                                                                                                                               | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | dc63b52ae4d8 |
| `src/components/auth/password-mfa-challenge.tsx`                              | rewiring          | Browser client imported from the foundation module (`restored-browser-client`) instead of `@/lib/supabase/client`, which only re-exported it.                                                                                                                                                                                                                                                                                                                                               | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | aa44044746ab |
| `src/hooks/use-kyc-status.ts`                                                 | rewiring          | Browser client imported from the foundation module (`restored-browser-client`) instead of `@/lib/supabase/client`, which only re-exported it. Group 74: deleted. No screen used this hook; it read an old table the live backend does not have. | Nothing (same look and steps) Group 74: Nothing (no screen used it) | keep     | awaiting owner; group 74: approved by owner 2026-11-21 | 2026-11-20 | deleted |
| `src/components/home/hero-banner-with-data.tsx` | rewiring | The home showroom reads the foundation post cards only; the retired fair-rotation options are no longer passed. Group 57: no longer works out the visitor's province (network estimate or chosen cookie), which only the removed chip used (row A16). | Nothing (same look and steps). Group 57: nothing. | keep | awaiting owner; group 57 part awaiting owner | 2026-11-19 | 7847e1e38905 |
| `src/components/showrooms/streamed-showroom.tsx` | rewiring | The area showroom reads the foundation post cards only; it no longer opens a retired Supabase client or passes the stub fixture option. Group 57: no longer works out the visitor's province (network estimate or chosen cookie), which only the removed chip used (row A16). | Nothing (same look and steps). Group 57: nothing. | keep | awaiting owner; group 57 part awaiting owner | 2026-11-19 | b06cf022ab8b |
| `src/components/admin/otp-delivery-card.tsx`                                  | rewiring          | Deleted: no page rendered it; it listed the retired backend's OTP log.                                                                                                                                                                                                                                                                                                                                                                                                                      | Nothing (no page showed it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | keep     | awaiting owner                                                                                                                                                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/app/opengraph-image.tsx`                                                 | rewiring          | M9.9: serves the same picture as a stored PNG, drawn ahead of time from `src/lib/sharing/default-share-image.tsx` with the renderer this route used (`pnpm share-image:default`), so the image renderer leaves the main Worker.                                                                                                                                                                                                                                                             | Nothing: the same site-wide link-preview picture at the same address                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | keep     | approved by owner 2026-11-13; awaiting owner                                                                                                                                                                                                                                                                                | 2026-11-13 | 1e1e94997ec7 |

### 5. Tests and helpers

| File                                                                | Kind   | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | What changes on screen       | Proposed | Owner decision                                                                                                                                                                              | Date       | Version      |
| ------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/components/admin/use-content-decision.test.tsx`                | test   | New unit test for the decision hook. Retired-backend cases removed; the rest run on the new backend. No longer sets the removed backend switch.                                                                                                                                                                                                                                                                                                                                                   | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | df4601892da2 |
| `src/components/dashboard/introductory-trial-card.test.tsx` | test | Tests for the trial card's new-backend free week (M2.3). Mocks the foundation browser client module. Group 27: the tests of the removed retired-backend reading are replaced by a test that a pending 30-day trial offers no switch or renewal while they are hidden. Group 57: tests follow the removals (no hidden-state checks of removed code; no visitor province passed to the showroom). | Nothing (not part of a page). Group 57: nothing. | keep | approved by owner 2026-11-10 (M2.3 free week); group 27 part awaiting owner; group 57 part awaiting owner | 2026-11-19 | 9a4869c9fc66 |
| `src/components/dashboard/leads-feed.test.tsx`                      | test   | Tests for foundation reload path. Retired-backend cases removed; the rest run on the new backend.                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-08 | d5e2fe3b7f42 |
| `src/components/listings/content-contact-actions.test.tsx` | test | Tests for the challenge step. M9.4: the token helper's mock follows its new browser-only module. M10.8: tests for the compact out-of-sight check, the empty-number message and the empty-contact note. Retired-backend removal: mocks the foundation browser client module; no backend switch. Group 27: drops two settings of the removed backend switch. Group 66: Checks WhatsApp is outlined in the contact card. Group 74: the mock also provides the enquiry form's named profile read. | Nothing (not part of a page) Group 66: Nothing (not part of a page) Group 74: Nothing (not part of a page) | keep | awaiting owner (earlier change); M9.4 part approved by owner 2026-11-12; M10.8 part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 27 part awaiting owner; group 66 part approved by owner 2026-11-20; group 74: approved by owner 2026-11-21 | 2026-11-20 | 65151204c01e |
| `src/hooks/use-post-action-fields.test.tsx`                         | test   | New test. Retired-backend cases removed; the rest run on the new backend. No longer sets the removed backend switch.                                                                                                                                                                                                                                                                                                                                                                              | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 98b4d9f0b82e |
| `src/hooks/use-post-action-fields.ts`                               | helper | New hook: revision + operation id for owner post actions. Retired-backend branch removed.                                                                                                                                                                                                                                                                                                                                                                                                         | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-08 | 043099aaa0ea |
| `src/hooks/use-post-transport.test.tsx`                             | test   | New test. Retired-backend cases removed; the rest run on the new backend. No longer sets the removed backend switch. Group 86: checks the terms acceptance for a copy and the renewed request. Group 114: checks the network-failure message. | Nothing (not part of a page) Group 114: Nothing (not part of a page) | keep     | awaiting owner; group 86 part approved by owner 2026-11-22; group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | fb330295f475 |
| `src/hooks/use-post-transport.ts`                                   | helper | New hook: posting-terms version/hash and request receipt for the existing forms. Retired-backend branch removed. Group 86: tells a form whether the current terms still need accepting, records the acceptance (used by a copy), and starts a new request after a definite answer. Group 114: a network failure while accepting the posting terms says so, instead of the forms' upload-service message. | Nothing (not part of a page) Group 86: nothing by itself (see create-listing in group 86). Group 114: Edit listing, business and tourism (and a copy), when the connection drops while accepting the terms: 'We couldn't reach VerifyMzansi to accept the posting terms. Check your connection and try again.' (was 'We couldn't reach the upload service. Check your connection and try again.'). | keep     | awaiting owner; group 86 part approved by owner 2026-11-22; group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 1ebebc94a3a9 |
| `src/hooks/use-realtime-foundation.test.tsx`                        | test   | New test. Mocks the foundation browser client module; no backend switch.                                                                                                                                                                                                                                                                                                                                                                                                                          | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 8aa9baf29fec |
| `src/app/billing/success/payment-status-panel.test.tsx` | test | Test for the new state. Group 60: checks the package confirmation, the Individual slot note and the one reload (waiting for the reload, which runs in an effect). Group 64: the check that a payment that is not a package never reloads now waits for the status request and its effects to settle first. | Nothing (not part of a page) | keep | awaiting owner; group 60 part approved by owner 2026-11-19; group 64 part approved by owner 2026-11-20 | 2026-11-20 | 9d62d101c2df |
| `src/app/dashboard/listings/page.test.tsx`                          | test   | Unit tests for the page reading from the new backend; expects no view counts (M2.8). Retired-backend cases removed; the rest run on the new backend. Group 86: checks More and Drafts with the switch on and a running package, and none without the package or with the switch off. Group 90: pins view totals off (not what these tests check). Group 98: no longer mocks the removed add-on buttons and checks. Group 115: no longer passes plan tiers the page stopped reading. | Nothing (not part of a page) Group 115: Nothing (not part of a page) | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); group 86 part approved by owner 2026-11-22; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 98 part approved by owner 2026-11-25 (answer: 'Approve them'); group 115 part approved by owner 2026-11-26 | 2026-11-26 | d62c4006af16 |
| `src/app/dashboard/page.test.tsx`                                   | test   | Unit tests for the page reading from the new backend; no second sign-in check (M9.2). Retired-backend removal: retired-backend cases removed; the rest run on the new backend. No longer mocks the removed engagement reads. Group 90: pins view totals off (not what these tests check). | Nothing (not part of a page) | keep     | awaiting owner (earlier change); M9.2 part approved by owner 2026-11-12; retired-backend removal part awaiting owner; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-12 | 0f707b636b16 |
| `src/app/dashboard/profile/page.test.tsx`                           | test   | Unit tests for the page reading from the new backend; email-change message. Mocks the foundation browser client module; no backend switch. Group 27: a test that, while account deletion is hidden, the Account tab shows no 'Delete' and links the data request form; the deletion tests switch it on. Group 43: tests for the row and dialog text, the typed word, the request it sends, the fresh sign-in step, the staff refusal, a lost or unclear answer, a retry with the session gone, and the closed state after success; the hidden-state test stays. Group 74: the mock serves the page's two named reads from the same per-test stubs. Group 76: a test that the avatar picker uploads a 2 MB photo and refuses one byte more before uploading. Group 97: a test that a page unmounted before the delay never redirects. Group 107: checks the read-only phone, the 'Change number' link and the editable province. Group 114: checks the dialog's package line. Group 115: the leave test uses fake timers instead of waiting 1.8 s. | Nothing (not part of a page) Group 74: Nothing (not part of a page) Group 76: nothing. Group 97: nothing. Group 114: Nothing (not part of a page) Group 115: Nothing (not part of a page) | keep     | awaiting owner; group 27 part awaiting owner; group 43 approved by owner 2026-11-19; group 74: approved by owner 2026-11-21; group 76 part awaiting owner; group 97 part awaiting owner; group 107 part approved by owner 2026-11-25 (answer: 'Approve them'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51; group 115 part approved by owner 2026-11-26 | 2026-11-26 | 6c5aa8174be4 |
| `src/app/page.test.tsx`                                             | test   | Stubs app URL. M10.3: the identity line sits under the showroom, said once.                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (not part of a page) | keep     | awaiting owner; M10.3 part approved by owner 2026-11-12                                                                                                                                     | 2026-11-12 | 6109f5bad043 |
| `src/app/post/create-route-guards.test.tsx`                         | test   | Pins these cases to the old backend; the new backend's check has its own test. Deleted: it only covered the retired backend's check; the foundation check has its own test.                                                                                                                                                                                                                                                                                                                       | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/app/post/edit-business/[id]/page.test.tsx` | test | Runs on the foundation backend that production uses; serves the posting terms and post revision the form loads and checks both are sent on save; reads the post from the owner URL. M4.4a: states a 30-second clip (jsdom cannot read video headers). Group 95: the edit form's posting-terms tick (shown only when needed, blocks saving until ticked, terms accepted before the save). Group 125: typed service areas are saved; an untouched edit keeps the saved areas. | Nothing (not part of a page) Nothing (not part of a page) | keep | awaiting owner; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 125 part awaiting owner | 2026-11-27 | a1afe6a6c8ca |
| `src/app/verification/page.test.tsx` | test | Unit tests for the page reading from the new backend. M6.2: checks that the detection button is hidden and the list still saves; the detection tests switch it on. Phone codes: checks that no delivery hint shows when no code was sent. Phone bans: the neutral message for a blocked number, without the hint. Phone errors: the message under the number and code fields, not a toast. Page view: group 46 (only the status is read on page view; nothing is started before the member acts). Group 69: a camera stand-in replaces the file fallback; checks camera-only uploads, the new labels and Continue on your phone. Group 76: a test that a 5 MB ID photo is accepted and one byte more is refused; the camera stand-in can set the photo's size. Group 99: Manual unchanged, the paused line, consent before any start, the check in the page and its result, a decline with ask a person. Group 101: the independent check test expects the new keep-for line and the consent's countries. | Nothing (not part of a page) Group 76: nothing. Group 101: nothing (not part of a page). | keep | awaiting owner; group 69 part approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens); group 76 part awaiting owner; group 99 part approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 73995e1133e1 |
| `src/components/dashboard/listing-manager-mini.test.tsx`            | test   | The test now expects no view count. Group 90: pins view totals off, the branch these tests check (on in production). | Nothing (not part of a page) | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures')                                                          | 2026-11-10 | 818ae88bdc0b |
| `src/components/listings/listing-card-list.test.tsx`                | test   | The test now expects no like button. Group 90: pins view totals off, the branch these tests check (on in production). | Nothing (not part of a page) | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures')                                                          | 2026-11-10 | b52f47e135b3 |
| `src/components/listings/listing-detail-content.test.tsx`           | test   | The test now expects no view count. M10.6: tests that the main photo gets the showroom card's price line, title and town, hidden from screen readers. Group 85: checks the storefront seller block. Group 90: pins view totals off, the branch these tests check (on in production). | Nothing (not part of a page) | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); M10.6 part approved by owner 2026-11-12; group 85 part approved by owner 2026-11-21; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-21 | 24479ee492ee |
| `src/components/showrooms/showroom-card-carousel-skeleton.test.tsx` | test   | New test: no room for the hidden chip.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing (not part of a page) | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works)                                                                                                                                   | 2026-11-10 | a66a5512a1c4 |
| `src/components/showrooms/showroom-card-carousel.test.tsx` | test | The test now expects no province chip and no room for it. Group 57: tests follow the removals (no hidden-state checks of removed code; no visitor province passed to the showroom). | Nothing (not part of a page). Group 57: nothing. | keep | approved by owner 2026-11-10 (M2.8 hidden until it works); group 57 part awaiting owner | 2026-11-19 | 308e26c1b1b7 |
| `src/components/home/placeholder-content-filter.test.ts`            | test   | Deleted: it only tested a one-line re-export of `src/lib/utils/placeholder-content.ts`, whose own tests cover the rule; its one extra case moved there.                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/components/listings/promotion-detail-content.test.tsx`         | test   | Removed an assertion that always passed (`expect(container).toBeTruthy()`); the test keeps its real checks. M10.6: tests that the main photo gets the showroom card's price line, title and town, hidden from screen readers.                                                                                                                                                                                                                                                                     | Nothing (not part of a page) | keep     | awaiting owner (earlier change); M10.6 part approved by owner 2026-11-12                                                                                                                    | 2026-11-12 | ea06e137cb5d |
| `src/app/post/create-business/page.test.tsx`                        | test   | Runs on the foundation backend that production uses; serves the posting terms the form loads and checks they are sent with the post. M4.4a: states a 30-second clip (jsdom cannot read video headers). Group 125: service areas are submitted; a server service-area error names Step 2 and the plain label; an old draft's typed areas are restored. | Nothing (not part of a page) Nothing (not part of a page) | keep     | awaiting owner; group 125 part awaiting owner | 2026-11-27 | 987951a13211 |
| `src/app/post/create-listing/page.test.tsx`                         | test   | Runs on the foundation backend that production uses; serves the posting terms the form loads and checks they are sent with the post. Videos go only through the validated upload. M4.4a: states a 30-second clip (jsdom cannot read video headers). Group 86: checks a copy opens on step 3 with its note, saves then submits, never touches the autosave, asks a vehicle for a new photo, and goes back to My posts when the copy is no longer a draft. Group 87: checks a template fills the form instead of the saved draft. Group 87: checks Undo brings the draft back in the form and in storage. Group 87: checks the old draft stays saved until the first edit, the message stays, a category change ends the offer, and a kept page with a template. Group 87: checks the area fill, a template that changes nothing, leaving the form and Undo reading the stored draft. Group 115: checks a kept page opened without the copy keeps nothing from it. | Nothing (not part of a page) Group 115: Nothing (not part of a page) | keep     | awaiting owner (earlier change); M6.4 part approved by owner 2026-11-12; group 86 part approved by owner 2026-11-22; group 87 part approved by owner 2026-11-22; group 115 part approved by owner 2026-11-26 | 2026-11-26 | b25f36fdd3e0 |
| `src/app/post/create-tourism/page.test.tsx`                         | test   | Runs on the foundation backend that production uses; serves the posting terms the form loads and checks they are sent with the post. Merges four near-identical upload-limit cases into one table. M4.4a: states a 30-second clip; a 90-second event video is refused at submit; the failed-conversion case fails both attempts.                                                                                                                                                                  | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-14 | b1afc106dbb3 |
| `src/app/post/edit-listing/[id]/page.test.tsx` | test | Runs on the foundation backend that production uses; serves the posting terms and post revision the form loads and checks both are sent on save. Mocks the foundation browser client module. Group 87: pins SHOW_POST_TEMPLATES off, so these save tests make no template read. Group 95: the edit form's posting-terms tick (shown only when needed, blocks saving until ticked, terms accepted before the save). Group 115: answers the template read instead of switching templates off; checks a refused acceptance uploads and saves nothing. | Nothing (not part of a page) Group 115: Nothing (not part of a page) | keep | awaiting owner; group 87 part test only (not part of the owner's 22 November approval); group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26 | 2026-11-26 | 7dc4fe1647a0 |
| `src/app/post/edit-tourism/[id]/page.test.tsx` | test | Runs on the foundation backend that production uses; serves the posting terms and post revision the form loads and checks both are sent on save. Group 95: the edit form's posting-terms tick (shown only when needed, blocks saving until ticked, terms accepted before the save). | Nothing (not part of a page) | keep | awaiting owner; group 95 part approved by owner 2026-11-24 (answer: 'Yes, approve both') | 2026-11-24 | 2376fc6c4684 |
| `src/components/admin/evidence-viewer.test.tsx`                     | test   | Runs on the new backend; checks the staff account; absorbs a duplicate test. Mocks the foundation browser client module.                                                                                                                                                                                                                                                                                                                                                                          | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | ec1f07cb5736 |
| `src/app/(marketplace)/mzansi-business/[id]/page.test.tsx`          | test   | Runs on the new backend; retired-backend cases removed. Group 85: checks 'All stock' and the hidden 'Live offers' fact. | Nothing (not part of a page) | keep     | awaiting owner; group 85 part approved by owner 2026-11-21 | 2026-11-21 | c484cf046182 |
| `src/app/(marketplace)/promotions/events/page.test.tsx`             | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | f03d7a2ac55b |
| `src/app/admin/dsar/page.test.tsx`                                  | test   | Runs on the new backend; retired-backend cases removed. Group 78: a test that the export is offered for a verified access request in progress and not for a completed one. | Nothing (not part of a page) Group 78: Nothing (not part of a page) | keep     | awaiting owner; group 78 part approved by owner 2026-11-21 | 2026-11-21 | aeedb9c677fd |
| `src/app/admin/moderation/page.test.tsx`                            | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 33fafa65e13f |
| `src/app/admin/support/page.test.tsx`                               | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 8b2a07ac02f4 |
| `src/app/dashboard/affiliations/page.test.tsx`                      | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 7462928c37a6 |
| `src/app/listing/[id]/page.test.tsx`                                | test   | Runs on the new backend; retired-backend cases removed. Group 85: the page reads the storefront seller (none in these tests). | Nothing (not part of a page) | keep     | awaiting owner; group 85 part approved by owner 2026-11-21 | 2026-11-21 | 6491e14442df |
| `src/app/tourism-events/[id]/page.test.tsx`                         | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 9aba8ad7aee9 |
| `src/components/admin/moderation/moderation-queue-client.test.tsx`  | test   | Runs on the new backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | e80cd105bf79 |
| `src/components/home/playwright-fixture-filter.ts`                  | helper | Deleted: it hid the retired stub browser suite's fixture rows.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/components/home/playwright-fixture-filter.test.ts`             | test   | Deleted with the helper it tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/components/admin/otp-delivery-card.test.tsx`                   | test   | Deleted with the unused card it tested.                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | deleted      |
| `src/app/(auth)/reset-password/page.test.tsx`                       | test   | Mocks the foundation browser client module.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 64359ef834c4 |
| `src/app/(marketplace)/mzansi-business/page.test.tsx`               | test   | No longer mocks the removed stub fixture helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 53985a453f54 |
| `src/app/(marketplace)/mzansi-market/page.test.tsx`                 | test   | No longer mocks the removed stub fixture helpers.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 2e915cfd13fd |
| `src/app/(marketplace)/promotions/page.test.tsx` | test | No longer mocks the removed stub fixture helpers or the retired owner-column helper; expects the foundation showroom read. Group 57: tests follow the removals (no hidden-state checks of removed code; no visitor province passed to the showroom). | Nothing (not part of a page). Group 57: nothing. | keep | awaiting owner; group 57 part awaiting owner | 2026-11-19 | 1afdad06d046 |
| `src/app/admin/audit-log/page.test.tsx`                             | test   | Runs on the foundation backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | d987edcb0c15 |
| `src/app/admin/reports/page.test.tsx`                               | test   | Runs on the foundation backend; retired-backend cases removed.                                                                                                                                                                                                                                                                                                                                                                                                                                    | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 34269c4f70c8 |
| `src/app/dashboard/complete-profile/page.test.tsx`                  | test   | Mocks the foundation browser client module. Phone errors: the message under the number and code fields, the rate-limit wait. Group 75: the mock serves the page's named profile read; a test that the page no longer makes a table-style call. Group 75 follow-up (review): a test that a signed-out visitor is sent to sign in. Group 107: checks change mode (title, card title, empty field, no redirect). | Nothing (not part of a page) Group 75: Nothing (not part of a page) Group 75 follow-up: Nothing (not part of a page) | keep     | awaiting owner ; group 75: approved by owner 2026-11-21 ; group 75 follow-up: awaiting owner; group 107 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-21 | 02d833297bff |
| `src/app/dashboard/layout.test.tsx`                                 | test   | Mocks the foundation browser client module.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 5fdf8c182dec |
| `src/components/auth/password-mfa-challenge.test.tsx`               | test   | Mocks the foundation browser client module.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 93708526f2b9 |
| `src/components/home/hero-banner-with-data.test.tsx` | test | Expects the foundation showroom read. Group 57: tests follow the removals (no hidden-state checks of removed code; no visitor province passed to the showroom). Group 88: checks that a new post's New tag reaches its showroom card. | Nothing (not part of a page). Group 57: nothing. Group 88: nothing. | keep | awaiting owner; group 57 part awaiting owner; group 88 part awaiting owner | 2026-11-22 | 1f3d6f57f15a |
| `src/components/showrooms/streamed-showroom.test.tsx`               | test   | No longer passes the removed stub fixture option.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Nothing (not part of a page) | keep     | awaiting owner                                                                                                                                                                              | 2026-11-11 | 2a3c7a9214ef |
| `src/hooks/use-kyc-status.test.ts`                                  | test   | Mocks the foundation browser client module. Group 74: deleted with the hook. | Nothing (not part of a page) Group 74: Nothing (not part of a page) | keep     | awaiting owner; group 74: approved by owner 2026-11-21 | 2026-11-20 | deleted |

### 6. Hidden until it works (roadmap M2.8)

Counters and chips that stated something untrue on the live site are hidden in
place (owner rule 2). Nothing new is added and nothing is restyled; each element
is removed where it stood. They return when the live backend stores views and
likes and orders showrooms by province (to be rebuilt after launch). The
switches are in `src/lib/hidden-features.ts`.

| File                                                           | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Proposed | Owner decision                                                                                                                                                                                         | Date       | Version      |
| -------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------ |
| `src/components/listings/content-like-button.tsx`              | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). The live backend does not store likes, so a like undid itself. Group 61: likes are stored by the new backend (anyone can like, one per browser and per signed-in account). The button sends the state asked for (liked or not) with the CSRF header, so a heart shown empty never undoes a like, and remembers this browser's likes on the device to fill its heart after the page loads. Group 61: a signed-out browser without its signed identifier gets one first (a Turnstile check, src/lib/views/viewer-challenge.tsx), then the like is sent again. Group 61: the check component moved to src/components/engagement/viewer-challenge.tsx. | The heart (like) button and its count are gone everywhere: Mzansi Market list cards, the desktop post viewer and the phone Video mode. Nothing takes their place. Group 61 (only while the counters are shown): the heart and its count are back as on 27 October; a like now stays, and the heart is filled on posts this browser liked. Group 61: the first like (or the first counted view) of a signed-out browser may show Cloudflare's 'Verify you are human' box in the bottom corner, only when Cloudflare needs a click. Group 61: when the check cannot be completed, the like is not sent and the heart goes back; screen readers hear 'Confirm you are not a robot to like posts'. | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); group 61 part awaiting owner | 2026-11-19 | 9030e20b20e1 |
| `src/components/listings/listing-detail-content.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored, so every post showed '0 views'. M10.2: price from the shared `describeListingPrice`, as on cards; a free item said 'Price on request'. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). M10.6: the showroom card's caption (price, title, pin and town) on the main photo, so phones show what it is and what it costs without scrolling (the owner's OD-05 answer approves this strip). Group 66: Phone bottom bar: only the first way to contact is filled. Group 85: optional seller business block (the business logo, or an initials tile when it has none; business name, 'Poster ID reviewed' and 'CIPC registered' stickers, 'See all N cars' link). | Market post page: the '0 views' item next to the posted date is gone; the date stays where it was. M10.2: the price reads like the card's: 'R1 450' (was 'R 1 450.00'), 'R12 499.50' with cents. A free item says 'Free' (was 'Price on request'); 'Negotiable' never shows with Free or a job's salary. Labels 'QUICK FACTS', fact names, 'MORE DETAILS' and 'KEEP BROWSING' in sentence case at 12 px (were 10 px letter-spaced capitals). M10.6 (phones narrower than 768 px): the bottom of the main photo shows the card's caption, 'R1 450 · Negotiable' (or 'Free', 'Price on request'), the title and the pin with the town, white on dark shading. On screens shorter than about 770 px the photo frame ends above the 'Contact seller' bar, so the caption is on the first screen; most phone photos (3:4) keep their size, only very tall pictures get narrower. The heading and price further down stay where they were (they are below the first screen). Tablets and desktops do not change. Group 66: Market post pages on phones, bottom bar: the first button ('Contact seller' or 'Call seller', or 'WhatsApp' when it is the only one) is filled green and any other is outlined; so 'WhatsApp' alone is now filled (was outlined), and beside 'Call seller' it stays outlined. Group 85 (switch on, listing in a storefront): the Seller card shows the business name with its logo (or initials), 'Poster ID reviewed', 'CIPC registered' and 'See all 18 cars' instead of the member's short name. | keep | approved by owner 2026-11-10 (M2.8 hidden until it works); M10.2 part approved by owner 2026-11-12; M10.6 part approved by owner 2026-11-12; group 66 part approved by owner 2026-11-20; group 85 part approved by owner 2026-11-21 | 2026-11-21 | d84daa9bc87a |
| `src/components/listings/promotion-detail-content.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored. M9.4: the full-screen photo viewer's code loads after the page (when the phone is idle, or on first tap), not with it. M10.2: one price format, as on cards. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). M10.6: the showroom card's caption (price, title, pin and town) on the main photo, so phones show what it is and what it costs without scrolling (the owner's OD-05 answer approves this strip). Group 61: the record type carries the like total. Group 66: Phone bottom bar: only the first way to contact is filled. | Event and tourism post page, Details panel: the 'Views 0' line is gone; Type and Category remain. (M9.4: the viewer opens and looks the same; on a tap before its code has arrived it appears once it has.) M10.2: an advert's price reads 'R150' (was 'R 150.00'); the Details labels ('WHEN', ...) in sentence case at 12 px (were 10 px letter-spaced capitals). M10.6 (phones narrower than 768 px): the event's main photo shows the card's caption, the cheapest ticket ('From R20', 'Free entry') or the advert's price, the title and the pin with the town, white on dark shading; the logo moves from the photo's bottom-left corner into the caption's right end, as on the showroom card. Over a video the caption sits above the controls and fades while the video plays. On screens shorter than about 770 px the photo frame ends above the contact bar. Tablets and desktops do not change. Group 61: nothing (type only). Group 66: Tourism & Events post pages on phones, bottom bar: the first button ('Contact organiser' or 'Call organiser', or 'WhatsApp' when it is the only one) is filled green and any other is outlined; so 'WhatsApp' alone is now filled (was outlined). | keep | approved by owner 2026-11-12 (M9.4; M2.8 hide approved 2026-11-10); M10.2 part approved by owner 2026-11-12; M10.6 part approved by owner 2026-11-12; group 61 part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | dadbec19b4e5 |
| `src/components/business/layouts/unified-layout.tsx`           | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored. (Earlier change: `&amp;` entity only.) M4.1: tells the event cards when an event has a video. M9.4: the full-screen photo viewer's code loads after the page (when the phone is idle, or on first tap), not with it. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). M10.6: the name over the main photo gains the card's pin and town on phones and also shows over a paused video, so phones show what the business is and where without scrolling; screen readers no longer hear the name twice. M10.8: a business that takes enquiries but shows no number gets the restored sticky contact bar (it had none; its form sat about 2.6 screens down); the contact card counts the email, website and social links before saying there are no contact details. Group 85: hides the 'Live offers' fact while the page shows the business's stock (plan section 1: no information twice). | Business page: the '0 views' line under the place is gone; the description moves up by that one line. M4.1 (awaiting owner): in the business page's 'Tourism & Events posts', an event with a video shows the video tile (poster and play button) instead of a generic picture, as in the chosen version. (M9.4: the viewer opens and looks the same; on a tap before its code has arrived it appears once it has.) M10.2: business page labels (the family line over the cover photo, fact names, 'Service model', 'Delivery', 'Photos and videos', 'Live offers', 'Active posts') in sentence case at 12 px (were 10 px letter-spaced capitals). M10.6 (phones narrower than 768 px): under the business name on the main photo, the pin and town ('Empangeni'); stronger dark shading behind the name block so the small text stays readable; over a profile video the logo, family line and name now show too, above the controls, fading while the video plays. On screens shorter than about 770 px the photo frame ends above the contact bar. All sizes: the name over the photo is skipped by screen readers (the heading below says it). Tablets and desktops otherwise do not change. M10.8 (phones and tablets below 1024 px): the bottom contact bar now also appears for businesses without a public number, with one green 'Send an enquiry' button that opens the existing enquiry form; the page keeps its bottom padding so the bar covers nothing. Businesses with numbers keep Call and WhatsApp as before. Group 85 (switch on, business with a storefront): the 'Live offers' fact is gone; 'Photos and videos' stays. | keep     | approved by owner 2026-11-12 (M4.1 and M9.4; M2.8 part approved 2026-11-10); M10.2 part approved by owner 2026-11-12; M10.6 part approved by owner 2026-11-12; M10.8 part approved by owner 2026-11-12; group 85 part approved by owner 2026-11-21 | 2026-11-21 | df2db259c39d |
| `src/components/immersive/immersive-action-rail.tsx`           | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Desktop post viewer, right-hand rail: the Views circle ('0 Views') is gone, and with the like button hidden the rail starts at Enquire or Share.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works)                                                                                                                                              | 2026-11-10 | a7404031a92e |
| `src/components/video-mode/video-mode-rails.tsx`               | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phone Video mode, right-hand rail: the views circle ('0') is gone, and with the like button hidden only Enquire remains (when the post takes enquiries).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works)                                                                                                                                              | 2026-11-10 | 7e0bb0e5b8ae |
| `src/app/dashboard/listings/page.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored. (Earlier change, approved 2026-11-09: post manager on the new backend and the deletion date.). Retired-backend branch removed. Group 61: My posts reads each publicly listed post's view total from the new backend while SHOW_ENGAGEMENT_TOTALS is on. Group 66: One filled post button on My posts; owner sign-off 20 Nov with 3 follow-ups, then owner: 'New post' stays filled when the member has posts and is outlined only when the empty list shows its own filled 'Create your first post'. Group 66 (owner: no black, light tourism colour): the 'All areas' chip is light teal (in area-filter.tsx). Group 86 (SHOW_POST_COPY): for a member whose Multi-listing package runs, Market listings get the 'More' button with 'Copy this post'; unfinished copies get a 'Drafts' tab with Continue and Delete. Group 98: the Urgent, Boost and Featured buttons ('Promote this post' group) and the plan-tier lookup they used are removed (paid add-ons removed). Group 114: gives Resubmit the post's Edit page. | My posts: the eye icon with '0 views' is gone from each post's details line. Earlier, approved: 'Will be deleted on <date>' and the Ended tab wording. Group 61 (only while the counters are shown): each live post shows its real view total; a post that is not live shows 0. Group 66: My posts: the header's 'New post' shows on every tab; filled green as before when the member has posts; with no posts yet it is outlined (white with a grey edge) and the empty list's filled 'Create your first post' is the one main button. Group 86 (switch on): a square 'More' (three dots) button before Delete on each Market listing of a member with a running package, opening 'Copy this post'; a 'Drafts (N)' tab after Ended when the member has unfinished copies, listing only copies, with the line 'Copies you have not sent for review yet. Each is deleted 14 days after your last change to it.' and each copy's card with 'Will be deleted on <date>', Continue and Delete. Group 98: My posts: no round Urgent, Boost or Featured buttons on a post; More and Delete follow the other buttons instead of sitting on the right; the line under the heading reads 'Edit or take posts offline.' (was 'Edit, promote or take posts offline.'). Group 114: See resubmit-button.tsx in group 114. | keep | approved by owner 2026-11-10 (M2.8 hidden until it works); group 61 part awaiting owner; group 66 part approved by owner 2026-11-20; group 86 part approved by owner 2026-11-22; group 98 part approved by owner 2026-11-25 (answer: 'Approve them'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 4429bcc5189f |
| `src/components/dashboard/listing-manager-mini.tsx`            | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Views are not stored. (Earlier change, approved 2026-11-09: the deletion date.) Group 66 (owner: no black, light tourism colour): the selected filter chip is light teal instead of black. | Dashboard home posts box: the eye icon with '0' is gone from each post's details line. Earlier, approved: 'Will be deleted on <date>'. Group 66: dashboard home posts box: the selected filter chip and its count are light teal with dark teal words instead of black with white words. | keep     | approved by owner 2026-11-10 (M2.8 hidden until it works); group 66 part approved by owner 2026-11-20 | 2026-11-20 | 3c01528cfc1c |
| `src/components/showrooms/showroom-card-carousel.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). The live showroom feed does not order posts by province, so the chip promised something the site did not do. M4.1: takes photo or video from the stored media (`mediaKind`), not the file name. Group 57: the hidden province chip, its room under an empty showroom and its switch are removed (row A16). Group 88: each card's showroom appearance is sent once per page load (the fair showroom counts a turn per visit; autoplay brought the same cards round again). | Home, Mzansi Market, Mzansi Business and Tourism & Events: the 'Showing <province> first · Change' chip under the showroom is gone, and so is the empty room kept for it under an empty showroom. The page below moves up by the chip's height (56 px). M4.1 (awaiting owner): a video post at the front of a showroom shows its video tile (poster and play button) instead of the area's artwork, and the showroom waits for the video to end before moving on (as for videos in the chosen version); side cards still show the post's photo. M10.1 (new, OD-04 rule 4): on screens with a mouse, where the showroom moves by itself, a round pause/play button in the arrows' glass style sits in the showroom's bottom-right corner and is first in its tab order; never shown on touch screens or with reduced motion. In a desktop window narrower than 768 px it overlaps the corner of the card's white details strip. The showroom no longer reads out each automatic move (it announces only the visitor's own moves or after a pause), and keyboard focus on the arrows holds it still like focus on the slides. Group 57: nothing (the chip was hidden). Group 88: nothing. | keep | approved by owner 2026-11-12 (M4.1 and M10.1; M2.8 part approved 2026-11-10); group 57 part awaiting owner; group 88 part awaiting owner | 2026-11-22 | 51771a3d67a3 |
| `src/components/showrooms/showroom-card-carousel-skeleton.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07: hide now, rebuild after launch). Keeps the loading showroom the same height as the loaded one now that the chip is hidden. Group 57: the room for the removed chip and its switch are removed (row A16). | While a showroom loads: no empty room for the chip, so nothing moves when the cards arrive. Group 57: nothing (the room was off with the chip). | keep | approved by owner 2026-11-10 (M2.8 hidden until it works); group 57 part awaiting owner | 2026-11-19 | 4b67f1d8d5cc |

### 7. Request reference on error pages (roadmap M5.1)

Error pages already show a short reference for support. It now shows
Cloudflare's request number, which leads straight to the matching server log
line. Nothing is added or restyled; only the value in the existing line changes,
and it is longer (20 characters instead of about 10).

| File                                            | Kind              | Reason                                                                                                                                                              | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                    | Proposed | Owner decision                      | Date       | Version      |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------- | ---------- | ------------ |
| `src/app/error.tsx`                             | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Most pages: inside 'Technical details': shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                                             | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 7117b77d9585 |
| `src/app/global-error.tsx`                      | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | The whole-site error page (when the page frame itself fails): the small line under 'Email support': shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before. | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | a182f6853822 |
| `src/app/(auth)/error.tsx`                      | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Sign-in and register error page: the 'Reference for support' box: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                   | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 5652c7f48f2f |
| `src/app/(marketplace)/error.tsx`               | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Market, business and tourism lists: the small line under the panel: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                 | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 5e14edd30bad |
| `src/app/(marketplace)/mzansi-market/error.tsx` | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Mzansi Market error page: the small line under the panel: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                           | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 87ac754a4234 |
| `src/app/listing/[id]/error.tsx`                | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Market post page error: the small line under the panel: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                             | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | daa2fb32ee46 |
| `src/app/tourism-events/[id]/error.tsx`         | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Event and tourism post page error: the small line under the panel: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                  | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 2e321ac11980 |
| `src/app/billing/error.tsx`                     | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Billing error page: the 'Error reference' line: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                                     | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | acc5bf17ff59 |
| `src/app/verification/error.tsx`                | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Verification error page: the 'Error reference' line: shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                                | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 9d1ccac814d6 |
| `src/app/admin/error.tsx`                       | wording-behaviour | Roadmap M5.1: the reference a visitor quotes to support now finds the exact failed request in the server logs.                                                      | Staff error page: the 'Reference' line (staff only): shows Cloudflare's request number (for example `8f1a2b3c4d5e6f70-JNB`) instead of the 10-digit error code, when the error happened while the page was first loading, before any in-page navigation, refresh or form action. Otherwise the error code as before. Same place, label and style; only shown for server errors, as before.                                                | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 77b95204512b |
| `src/hooks/use-error-reference.ts`              | helper            | New hook: reads the request number the proxy sends with each page (Server-Timing) only while nothing has happened in the page since it loaded, else the error code. | Nothing by itself (used by the error pages above)                                                                                                                                                                                                                                                                                                                                                                                         | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | a017caad7697 |
| `src/hooks/use-error-reference.test.tsx`        | test              | New test.                                                                                                                                                           | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M5.1) | 2026-11-10 | 76ebee35e3fc |

### 8. Videos shown as videos (roadmap M4.1)

The new backend names photos and videos without a file extension. Cards that
guessed "video" from the file name drew a video post as a photo that could not
load, then fell back to a generic picture. These cards now take "video" from the
post's own media, as the post pages already did, and show the restored
frontend's existing video tile (poster and play button), as the chosen version
did with the old backend. Nothing is added or restyled. Five more files with
this change already had rows (the home rails in group 4, the business page and
the showroom in group 6); their rows say so.

| File                                            | Kind     | Reason                                                                                                                                                                                                                                                                                                                                                                                                    | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Proposed | Owner decision                                                                                                        | Date       | Version      |
| ----------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/(marketplace)/mzansi-market/grid.tsx`  | rewiring | M4.1: tells each card when the listing has a video. M10.2: passes the post's price mode to the cards. Group 54: page links stop at page 100. | Mzansi Market grid and list: a listing with a video shows the video tile (poster and play button) instead of a generic picture, as in the chosen version. M10.2: a free item's card says 'Free' (see `listing-card.tsx`). Mzansi Market grid: Group 54: page links stop at page 100; on the last page, when there are more results, 'Showing the first N results. Narrow your search to see more.' (N = 100 pages of results); a deeper page address shows page 100. 24 a page, so 'Showing the first 2 400 results.' | keep     | approved by owner 2026-11-12 (M4.1); M10.2 part approved by owner 2026-11-12; group 54 part awaiting owner | 2026-11-19 | f27549027b03 |
| `src/app/(marketplace)/promotions/client.tsx` | rewiring | M4.1: tells each event card when the event has a video. The selected Events tab had white text on amber, 2.15:1 (WCAG 1.4.3 needs 4.5:1). With nothing posted the page blamed filters nobody had set. Group 54: page links stop at page 100. Group 66: Tourism & Events: the create button by the title is secondary. | Tourism & Events, events: an event with a video shows the video tile instead of a generic picture, as in the chosen version. Tourism & Events: the selected Events tab's label turns dark brown (`amber-950`) on the same amber fill, 6.97:1 (4.70:1 on hover); the dark theme is unchanged. With no filter set and nothing to show: 'No stays or events yet' (Tourism tab 'No stays or places yet', Events tab 'No events yet'), 'Be the first ID-reviewed host to list on Tourism & Events.' and only the list button; with a filter set, or on a page past the last one, the old message and 'Clear all filters' stay. Tourism & Events: Group 54: page links stop at page 100; on the last page, when there are more results, 'Showing the first N results. Narrow your search to see more.' (N = 100 pages of results); a deeper page address shows page 100. Group 66: Tourism & Events: 'List an event' / 'List a stay or place' next to the title is outlined instead of filled; the empty box's button stays filled; the filters drawer's 'Apply' is unchanged. | keep | approved by owner 2026-11-12 (M4.1 and M10.1); group 54 part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 223f1076fbe1 |
| `src/components/listings/business-card.tsx`     | rewiring | M4.1: a business with a cover video tells its card so.                                                                                                                                                                                                                                                                                                                                                    | Mzansi Business, Tourism & Events places and organisation pages: a business with a cover video shows the video tile instead of a generic picture, as in the chosen version.                                                                                                                                                                                                                                                                                                                                                                                                                                               | keep     | approved by owner 2026-11-12 (M4.1)                                                                                   | 2026-11-11 | 62ceead8ad28 |
| `src/components/listings/listing-card-list.tsx` | rewiring | M4.1: accepts the post's photo-or-video flag; without it the file name decides, as before. M10.2: price from the shared `describeListingPrice`. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). M10.5: the list-view video no longer follows the showroom's remembered Play choice, so on phones only the showroom's centre card plays by itself. Group 114: no longer passes add-on flags to the card status. | Mzansi Market list view: a listing with a video shows the small video player instead of a generic picture, as in the chosen version. M10.2: list view: a free item says 'Free'; status chips ('FEATURED', ...) in sentence case at 11 px (were 10 px letter-spaced capitals). M10.5 (awaiting owner): phones: after the visitor pressed Play on the showroom, list-view videos no longer start by themselves; its own Play button works as before. Computers: pausing one list-view video no longer pauses the other cards. Nothing changes in how it looks. Group 114: Nothing | keep     | approved by owner 2026-11-12 (M4.1); M10.2 part approved by owner 2026-11-12; M10.5 part approved by owner 2026-11-13; group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 032e14471d19 |
| `src/components/home/market-preview-card.tsx`   | rewiring | M4.1: passes the photo-or-video flag to the card. M10.2: one price format, as on grid cards and the post page.                                                                                                                                                                                                                                                                                            | Home page Mzansi Market rail: see `home-mzansi-market-showcase.tsx` (group 4). M10.2: home Mzansi Market rail: 'R 1 450' reads 'R1 450'; a free item says 'Free'.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | keep     | approved by owner 2026-11-12 (M4.1); M10.2 part approved by owner 2026-11-12                                          | 2026-11-12 | f2daf080c9b6 |
| `src/components/home/business-preview-card.tsx` | rewiring | M4.1: passes the photo-or-video flag to the card.                                                                                                                                                                                                                                                                                                                                                         | Home page Mzansi Business and Tourism & Events rails: see their showcase rows (group 4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | keep     | approved by owner 2026-11-12 (M4.1)                                                                                   | 2026-11-11 | db8fa57c3ef5 |

### 9. Lighter pages on phones (roadmap M9.4)

Less code and less painting on phones, with nothing changed on screen: heavy
parts load when needed, two decorative animations run on the graphics card, and
page settings that did nothing are removed. The picture checks guard the look.

| File                                                  | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Proposed | Owner decision                                                                                                                                                             | Date       | Version      |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/listing/[id]/client.tsx`                     | visual            | Loads the full-screen photo viewer's code after the page (when the phone is idle, or on first tap) instead of with it. M10.6: draws the caption the market post page passes over the main photo (or above the video controls), fading while the video plays.                                                                                                                                                                                                                                                       | Nothing: the viewer opens and looks the same. If a visitor taps before the code has arrived (it is fetched when the phone is idle or on the first touch), the viewer appears once it has, usually within a fraction of a second; nothing else changes. M10.6: see the market post page row (group 6): the card's caption on the main photo on phones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | keep     | approved by owner 2026-11-12 (M9.4); M10.6 part approved by owner 2026-11-12                                                                                               | 2026-11-12 | 4e43f8f1903f |
| `src/components/ui/media-lightbox-lazy.tsx`           | rewiring          | New: the same full-screen viewer (unchanged file `media-lightbox.tsx`) with its code fetched when the phone is idle or on the first touch; mounts on first open and stays for its closing animation; an invisible layer takes extra taps while the code arrives; hands the page its closed state back if the code cannot be fetched.                                                                                                                                                                               | Nothing: same viewer, same look. If a visitor taps before the code has arrived (it is fetched when the phone is idle or on the first touch), the viewer appears once it has, usually within a fraction of a second; nothing else changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M9.4)                                                                                                                                        | 2026-11-11 | d590decfd50a |
| `src/components/ui/media-lightbox-lazy.test.tsx`      | test              | New: tests that the viewer loads nothing before it is needed, starts loading on the first touch, opens at the chosen photo, stays mounted after closing and recovers when its code cannot be fetched.                                                                                                                                                                                                                                                                                                              | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | keep     | approved by owner 2026-11-12 (M9.4)                                                                                                                                        | 2026-11-11 | 344615fee803 |
| `src/components/listings/content-enquiry-action.tsx`  | rewiring          | Reads the security token through a browser-only helper, so post and business pages no longer download Next's server request code. Closing the enquiry dialog left keyboard focus at the top of the page (WCAG 2.4.3). Retired-backend removal: browser client imported from the foundation module (`restored-browser-client`) instead of `@/lib/supabase/client`, which only re-exported it. Group 74: the name the enquiry form fills in for a signed-in member comes from a named live-backend read of their own profile instead of an old table-style call translated into the same read. | Nothing (same look and steps) Nothing visible: after the enquiry or message dialog closes, focus is back on the button that opened it. Group 74: Nothing (same prefilled name) | keep     | approved by owner 2026-11-12 (M9.4 and M10.1); retired-backend removal part awaiting owner; group 74: approved by owner 2026-11-21 | 2026-11-20 | 33ab40c4a426 |
| `src/components/shared/report-dialog.tsx`             | rewiring          | Reads the security token through a browser-only helper, so business pages no longer download Next's server request code.                                                                                                                                                                                                                                                                                                                                                                                           | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M9.4)                                                                                                                                        | 2026-11-11 | 7c892c9c15eb |
| `src/components/business/customer-access-summary.tsx` | rewiring          | Checks the saved 'How we serve customers' answer without the form library zod (about 28 KiB less on business pages); a test compares it with the old check on generated answers, emoji and rare characters included: same accepted answers, same lines shown.                                                                                                                                                                                                                                                      | Nothing: the section shows the same lines for the same businesses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep     | approved by owner 2026-11-12 (M9.4)                                                                                                                                        | 2026-11-11 | 1e5b43b2b13d |
| `src/styles/globals.css`                              | visual            | Loading placeholders' shimmer and the flag stripe's light sweep move as a transform on the graphics card instead of repainting the page every frame (finding PERF-13). Same colours, band, path, speed and timing; reduced-motion visitors still see them still. On posting pages the sticky Back/Next bar covered fields reached with Tab (WCAG 2.4.11).                                                                                                                                                          | Nothing intended: the same shimmer and sweep (owner rule 4 asks you to confirm the look). Posting forms only: a field reached with the keyboard is scrolled to sit above the Back/Next bar instead of under it. No colours or layout change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | keep     | approved by owner 2026-11-12 (M9.4 and M10.1)                                                                                                                              | 2026-11-12 | 1f9d0c8c87cf |
| `src/app/(marketplace)/mzansi-business/page.tsx` | rewiring | Drops `revalidate = 60`, which did nothing: every page renders per request (the layout reads request headers). Retired-backend removal: stub browser suite fixture-hiding cookie removed (test-only; never active in production). Group 66: Mzansi Business: the create button by the title is secondary. | Nothing (same look and steps) Group 66: Mzansi Business (phone and desktop): 'Add a business' next to the title is outlined instead of filled; the empty box's 'Add a business' stays filled. | keep | approved by owner 2026-11-12 (M9.4); retired-backend removal part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 7eb4d28a19a7 |
| `src/app/(marketplace)/mzansi-market/page.tsx` | rewiring | Drops `revalidate = 60`, which did nothing: every page renders per request. Retired-backend removal: stub browser suite fixture-hiding cookie removed (test-only; never active in production). Group 66: Mzansi Market: the create button by the title is secondary. | Nothing (same look and steps) Group 66: Mzansi Market (phone and desktop): 'Create a listing' next to the title is outlined instead of filled; with no posts, the empty box's 'Post a listing' is the one filled button. | keep | approved by owner 2026-11-12 (M9.4); retired-backend removal part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 62fd3828e19e |
| `src/app/(marketplace)/promotions/page.tsx`           | rewiring          | Drops `revalidate = 60`, which did nothing: every page renders per request. Retired-backend removal: stub browser suite fixture-hiding cookie removed (test-only; never active in production).                                                                                                                                                                                                                                                                                                                     | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M9.4); retired-backend removal part awaiting owner                                                                                           | 2026-11-11 | 70aee8b139b6 |
| `src/app/tourism-events/page.tsx`                     | rewiring          | Drops `revalidate = 60`, which did nothing: every page renders per request.                                                                                                                                                                                                                                                                                                                                                                                                                                        | Nothing (same look and steps)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M9.4)                                                                                                                                        | 2026-11-11 | 3b6de2a7cf1a |
| `src/app/advertise/page.tsx` | wording-behaviour | Drops `revalidate = 300` and its comment ('refresh every five minutes'), which did nothing: every page renders per request. M10.2: small labels lose their letter-spaced capitals (the design system bans tracked ALL-CAPS labels). Group 40: the page matches the Terms (posting-v5) and what the site does. The sponsor programme is on hold and paid add-ons do not deliver, so both are hidden (owner rule 2); the cancel answer, the slot limit and the edit allowance follow the Terms and the live backend. Group 52: the hidden 'Founding pilots' box, which named a council programme VerifyMzansi has no agreement for, is removed. The hidden Multi-listing price list says 'any number from 5 to 250'. Group 66: Gold main button on the dark bands; the black buttons retired; no second 'Post for free' band. Group 66 (owner: no black, light tourism colour): the 'How it works' step numbers are light teal. Group 90: 'See … prices' only on the Individual package; the Multi-listing and Business Sponsor packages show their price sheet on this page (their /pricing links led nowhere). Group 98: the 'Get more eyes on a post' section (Urgent, Boost, Featured and their prices) is removed (paid add-ons removed). Group 101: the ID check wording is true on every ID check setting (staff or Didit). Group 114: the 'Can I cancel?' answer follows Terms posting-v6 Refunds & cancelling: the first-purchase refund, how refunds are paid, and the package. | M10.2: Advertise page: the three small green labels above section headings ('VIDEO', 'WHY POST HERE', ...) in sentence case, normal letter spacing; same size and colour. Pricing switch (group 17): the Multi-listing package, its card and its prices are hidden ('Two ways to advertise'); the sponsor fee table shows 'Any number: By written proposal' and no 'See sponsor fees' link; Individual prices R69 / R207 / R414 with 'Paid slots open soon. Until then, your first post and events are free.' under them; 'Your first post free ... (7 days)' without '30 while launch spaces last'; the page description no longer names multi-listing. Group 40: no Business Sponsor package (its card, 'Founding pilots' box and fee table), no 'What a partner report looks like', no '“Supported by” is programme membership' line, no sponsor questions and no 'Talk to us about sponsoring' button; with one package left, no 'Which one is for you?' chooser; no 'Get more eyes on a post' (Urgent, Boost, Featured). Individual: the lede reads 'Each slot keeps one post live, in any section, and you can hold 1 to 4 slots at a time. The simplest way to reach local buyers, with your ID reviewed before you post.' (was 'One live slot, in any section. ... with a post people can trust.'); '1 live slot in ...' reads '1 to 4 live slots at a time in Mzansi Market, Mzansi Business or Tourism & Events, one post each'; the price list caption reads 'Individual slots (price per slot)'; 'Up to 2 approved edits per live post' reads 'Each live post: up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot'. 'Can I cancel?' states the Terms' Paying and Refunds & cancelling rules and links to 'Refunds & cancelling in the Terms' (wording in group 40). The search description reads 'Why advertise on VerifyMzansi: individual posts in any section, from people whose ID our team has reviewed.' The hidden Multi-listing package states the P4a rules (from 5 slots at R100 per slot per 30 days, 30, 90 or 180 days, up to 4 posts going live per slot per 30 days, by invoice above Ozow's maximum or 100 slots) instead of '10 to 100', '90 or 180 day terms', '2 named administrators' and 'written quote'. Group 52: nothing today (the sponsor section is hidden); when shown, no 'Founding pilots' box. Multi-listing price list (hidden): 'any number from 5 to 250' (was 'any number from 5'). Group 66: Advertise: hero 'Post for free' gold (was green), 'See plans' outlined as before; 'Post with a video' and each plan's first button ('Post for free', 'Choose a multi-listing plan', 'Request a sponsor proposal') outlined (were black); the footer's 'Got something to sell' band is hidden; the 'Ready when you are.' band stays, its 'Post for free' gold (was green). Group 66: Advertise 'How it works': the numbers 1 to 4 sit in light teal circles with dark teal figures instead of black circles with white figures. Group 98: Advertise: no 'Get more eyes on a post' section. Group 101: Advertise: 'What we check' reads 'SA ID or SA passport and a selfie reviewed by our team or our verification partner' (was '... reviewed by our team'); the search description reads '... from people whose ID we have reviewed.' (was 'whose ID our team has reviewed'). Group 114: Advertise, 'Can I cancel?': adds 'Your first purchase: if you email billing@verifymzansi.com from your account's email address within 5 business days after its payment is confirmed, we cancel it and refund it in full.'; 'a change of mind is not a reason for a refund' now starts 'Apart from your first purchase'; cancelling covers 'a slot or a Multi-listing package'; 'Closing your account counts as a request to cancel all your slots and your package.' (was 'Closing your account cancels all your slots.'); refunds 'are paid to the original payment method, through our payment provider's refund service, or by EFT into a bank account in your own name, within 30 days after we approve them' (was 'go to the account that paid'). | keep | approved by owner 2026-11-12 (M9.4); M10.2 part approved by owner 2026-11-12; pricing switch part approved by owner 2026-11-12; group 40 part approved by owner 2026-11-17; group 52 part awaiting owner; group 66 part approved by owner 2026-11-20; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 98 part approved by owner 2026-11-25 (answer: 'Approve them'); group 101 part approved by owner 2026-11-25 (answer: 'Approve them'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 630756d45dc0 |
| `src/app/pricing/page.tsx` | rewiring | Drops `revalidate = 300`, which did nothing: every page renders per request. Live-test fix (group 35): names its canonical address (`/pricing`). Group 49: the plans section shows the offers (Individual, and Multi-listing while packages are on sale) through pricing-offers.tsx instead of retail-pricing.tsx. Group 49 also stops rendering the hidden Multi-listing and sponsor block (enterprise-pricing.tsx) below the plans: once packages are on sale the Multi-listing tab offers them, so they are not offered twice. Group 55: the approved-edits box is headed for every post, not only packages. Group 66: The hero already offers 'Post for free'. Group 68: the old commercial_settings read for the free-post days is removed; the trial texts use their fixed defaults, which is what production already showed (that read always failed on the live backend). Group 79: the VAT status in the billing answers is read from the database setting (api.get_vat_registration) instead of a fixed sentence. | Nothing (same look and steps) Pricing switch (group 17): the Multi-listing and Business Sponsor block below the plans is hidden; the plan cards come from retail-pricing.tsx; the search description reads 'your first post is free and events are free. Individual slots cost R69 for 30 days, R207 for 90 days or R414 for 180 days, in any section.'; offers are described to search engines only while on sale. Invoice choice: group 36. Group 49: heading 'Posting slots', no section picker; see group 49. Group 55: the approved-edits box is headed 'Editing your post' (was 'How your package works'). Group 66: Pricing: the footer's 'Got something to sell' band is hidden; the rest of the footer is unchanged. Group 68: Nothing on screen. (before and after pictures identical) Group 79: Nothing on screen today ('VAT status: not registered for VAT.' as before); the line is left out if the setting cannot be read. | keep | approved by owner 2026-11-12 (M9.4); pricing switch part approved by owner 2026-11-12; group 36 approved 2026-11-17; group 49 approved by owner 2026-11-18 (variant B, picture 01); group 55 part approved by owner 2026-11-19; group 66 part approved by owner 2026-11-20; group 68 part approved by owner 2026-11-20; group 79 part approved by owner 2026-11-21 | 2026-11-21 | 75c851ae1088 |
| `src/app/sponsors/page.tsx` | wording-behaviour | Drops `revalidate = 300`, which did nothing: every page renders per request. Group 40: the sponsor programme is on hold (owner decision), so the offer is hidden (owner rule 2). Current sponsors are still listed. Group 52: the hidden 'joining' line no longer names a council or place. Group 66: The black button style is retired. Group 90: with no sponsors listed it always reads 'No sponsors yet' (no 'Our first Business Sponsors are joining' line). | Group 40: no 'Become a Business Sponsor' button under the heading and no 'Want to support local businesses?' band; while no sponsor is listed, the dashed box reads only 'No sponsors yet' (was 'Our first Business Sponsors are joining' and 'Founding programmes open in the City of uMhlathuze. ...'). Group 52: nothing today (hidden); when shown, the line reads 'Their businesses appear here as they go live.' Group 66: Business Sponsors: 'Become a Business Sponsor' would be outlined instead of black; it shows only while the sponsor offer is on (off today), so nothing changes now. | keep | approved by owner 2026-11-12 (M9.4); group 40 part approved by owner 2026-11-17; group 52 part awaiting owner; group 66 part approved by owner 2026-11-20; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-20 | 2ede224b5123 |

### 10. Keyboard and small fixes (roadmap M10.1)

Small repairs for keyboard and screen-reader visitors that keep the design. Five
rows elsewhere also carry M10.1 changes: `content-contact-actions.tsx` (group
2), `showroom-card-carousel.tsx` (group 6), `promotions/client.tsx` (group 8),
`content-enquiry-action.tsx` and `globals.css` (group 9).

| File                                                                | Kind              | Reason                                                                                                                                                               | What changes on screen                                                                                                             | Proposed | Owner decision                       | Date       | Version      |
| ------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------ | ---------- | ------------ |
| `src/app/error/page.tsx`                                            | wording-behaviour | Every visitor was sent to the dashboard, a sign-in page for anyone signed out. Live-test fix (group 35): marked noindex (it is where refused or failed checks land). | Error page: the buttons come from `error-page-actions.tsx` (next row).                                                             | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | 4befb30f55d3 |
| `src/app/error/error-page-actions.tsx`                              | wording-behaviour | New: picks the error page's buttons by sign-in state, the way the header does.                                                                                       | Signed-out visitors see one green 'Go to homepage' button; signed-in members see 'Go to dashboard' and 'Go to homepage' as before. | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | ead8a17b5ce5 |
| `src/components/post/post-form-scaffold.tsx`                        | wording-behaviour | Marks the sticky Back/Next and Cancel/Save bars so the page can keep focused fields above them (WCAG 2.4.11). Group 86: an optional note slot between the heading and the steps (used only by a copy). Group 125: the error list shows each field's form label and plain words instead of raw field paths and schema text. | Nothing visible; see `globals.css`. Nothing by itself (see create-listing in group 86). Group 125: posting and edit forms' error banner: 'Attributes.property Type: Invalid option…' reads 'Property type: Choose one of the options.'; 'Service Areas.areas' reads 'Service areas'; a raw length limit reads, for example, 'Must be at least 5 characters'. Labels the form names itself are unchanged. | keep     | approved by owner 2026-11-12 (M10.1); group 86 part approved by owner 2026-11-22; group 125 part awaiting owner | 2026-11-27 | 9b5763437d47 |
| `src/hooks/use-dialog-return-focus.ts`                              | helper            | New: returns focus to the control that opened a dialog opened from state, not from its own trigger.                                                                  | Nothing (not part of a page)                                                                                                       | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | 48467730202e |
| `src/hooks/use-dialog-return-focus.test.tsx`                        | test              | New unit test for the focus-return helper.                                                                                                                           | Nothing (not part of a page)                                                                                                       | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | 32a97a39afdf |
| `src/components/showrooms/showroom-card-carousel-rotation.test.tsx` | test              | New unit tests for the showroom's pause button and live region. Group 88: checks that autoplay sends each card's appearance once per page load. | Nothing (not part of a page) Group 88: nothing. | keep     | approved by owner 2026-11-12 (M10.1); group 88 part awaiting owner | 2026-11-22 | 4f5c60ad9cf3 |
| `src/app/(marketplace)/promotions/client.test.tsx`                  | test              | Tests for the Events tab colour and the empty messages with and without filters.                                                                                     | Nothing (not part of a page)                                                                                                       | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | 28877c56eece |
| `src/app/error/page.test.tsx`                                       | test              | Tests the error page's buttons for signed-in members and signed-out visitors. Live-test fix (group 35): checks the noindex marking.                                  | Nothing (not part of a page)                                                                                                       | keep     | approved by owner 2026-11-12 (M10.1) | 2026-11-12 | 21407edab13b |

### 11. Consistent details (roadmap M10.2)

One price format on cards and post pages, no letter-spaced capitals, and a
header that never covers the logo at 320 px, inside the existing look. The
shared price wording lives in `src/lib/presentation/listing-facts.ts`
(`describeListingPrice`), also used by the immersive viewer
(`src/lib/feed/presenters.ts`) and the business facts
(`src/lib/presentation/business-facts.ts`); those files are outside the checked
scope. Eleven rows elsewhere also carry M10.2 changes; their decision includes
'M10.2 part approved by owner 2026-11-12'.

| File                                                            | Kind   | Reason                                                                                                                                                                                                                                                                                                                                                  | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Proposed | Owner decision                                                                                                         | Date       | Version      |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/(auth)/layout.tsx`                                     | visual | Letter-spaced capitals (the design system bans tracked ALL-CAPS labels).                                                                                                                                                                                                                                                                                | Sign-in and register panel: the gold 'DISCOVER · CONNECT' line reads 'Discover · Connect' in normal letter spacing; same size, colour and place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 0107c98619f5 |
| `src/app/post/create/post-create-client.tsx`                    | visual | Letter-spaced capitals. Group 66 (owner: no black, light tourism colour): the black buttons are light teal. | 'What do you want to post?': the small area name on each option ('MZANSI MARKET', ...) reads 'Mzansi Market' at 12 px (was 11 px letter-spaced capitals). Group 66: 'What would you like to post?': 'Continue verification' and each card's button ('Create a market listing', 'Create a business profile', 'List a stay or experience', 'Create an event') are light teal with dark teal words instead of black with white words; on desktop a card's button still fills with its section colour under the pointer. | keep     | approved by owner 2026-11-12 (M10.2); group 66 part approved by owner 2026-11-20 | 2026-11-20 | 8ff6021f6be5 |
| `src/components/business/business-detail-content.tsx`           | visual | One price format: the call-out fee is written like every other price. Group 61: the record type carries the like total. | Business page call-out fee: 'R 350' reads 'R350'. Group 61: nothing (type only). | keep     | approved by owner 2026-11-12 (M10.2); group 61 part awaiting owner | 2026-11-19 | 157bba958f85 |
| `src/components/business/shared/business-contact-section.tsx`   | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Business contact card: 'CALL', 'WHATSAPP', 'EMAIL' read 'Call', 'WhatsApp', 'Email'; same size and colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 0c67d24bf77a |
| `src/components/business/shared/business-details-accordion.tsx` | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Business details: 'PAYMENT METHODS' and 'DELIVERY' in sentence case; same size and colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | ba866521dceb |
| `src/components/business/shared/business-sidebar-cards.tsx`     | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Business sidebar: the 'POSTED BY' heading reads 'Posted by'; same size and colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 8820bef986f1 |
| `src/components/home/home-about-section.tsx` | visual | Letter-spaced capitals. Group 66 (owner sign-off 20 Nov with 3 follow-ups): the footer band's gold 'Post for free' is Home's one main button. Group 101: the owner softened the positioning statement ('Soften it', 25 November 2026): posts come from ID-reviewed posters; businesses and products themselves are not verified. | Home page: the green label 'WHY VERIFYMZANSI' reads 'Why VerifyMzansi'; same size, colour and place. Group 66: Home: the About section's 'Post for free' is outlined (white with a grey edge, dark words) instead of filled green; same size, place and arrow. Group 101: Home, 'Know who you're dealing with.': 'VerifyMzansi connects people with businesses, products, services, tourism and events from ID-reviewed posters. Discover, connect and do business with confidence.' (was '... connects people with verified businesses, products, services, tourism and events. ...'). | keep | approved by owner 2026-11-12 (M10.2); group 66 part approved by owner 2026-11-20; group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 1877bf24900f |
| `src/components/home/home-sponsors-section.tsx` | visual | Letter-spaced capitals. Group 40: the sponsor offer is on hold (owner rule 2). Group 66: The black button style is retired. | Home page Business Sponsors band (shown when sponsors exist): the label reads 'Business Sponsors' in normal letter spacing. Group 40: no 'Become a Business Sponsor' button beside 'See supported businesses'. Group 66: Home, when sponsors are listed: 'See supported businesses' is outlined instead of black. | keep | approved by owner 2026-11-12 (M10.2); group 40 part approved by owner 2026-11-17; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 5f94460e4bdb |
| `src/components/layout/header.tsx` | visual | At 320 px the theme button sat on the 'Mzansi' wordmark, and the logo must stay exactly as it is. Fix: the 'Admin' menu item now shows for every staff role (governors too), not only moderators and admins. Group 66: Register and + Post are not the page's main action. | Signed-out phones narrower than 375 px: the header keeps Search and the menu button; the theme switch becomes the menu's last item ('Dark theme' / 'Light theme' with its moon or sun icon). 375 px and wider, and signed-in members (whose wordmark already steps aside below 400 px), see no change. Governors now see the 'Admin' menu item like moderators and admins. Group 66: Every page's header (desktop and the phone menu): 'Register' (signed out) and '+ Post' (signed in) are a light-green tinted pill with dark-green words, same place and words, instead of filled green; 'Sign in' unchanged. | keep | M10.2 part approved by owner 2026-11-12; staff link part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 228c198c5325 |
| `src/components/listings/listing-card.tsx`                      | visual | The card and the post page wrote the same price differently; the card now uses the shared `describeListingPrice`.                                                                                                                                                                                                                                       | Cards keep 'R1 450' and '· Neg'. A free item now says 'Free' (it showed no price). '· Neg' never shows with Free or a job's salary. Items priced on request stay without a price line, as before.                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 391aa800e67b |
| `src/components/listings/poster-card-shell.tsx`                 | visual | Letter-spaced capitals. M10.6: the caption over immersive card pictures now comes from the shared `PosterCaption` (same markup and classes), which post pages reuse. M10.5: a video card's whole surface is one link to the post, as showroom and home cards already were; the status and duration labels on the picture let taps through to that link. | Card fallback when a post has no picture: 'PUBLIC PREVIEW' reads 'Public preview'. Status chips on non-showroom cards ('FEATURED', ...) in sentence case at 11 px (were 10 px letter-spaced capitals). Showroom and grid cards show no chip, so they do not change. M10.6: nothing; the caption over showroom pictures looks the same. M10.5 (awaiting owner): a tap or click on a video card's picture opens the post (on touch screens it used to start the video; with a mouse it did nothing); the keyboard focus ring goes round the whole video card instead of only its details strip, and the link is read as 'Open <title>'. | keep     | approved by owner 2026-11-12 (M10.2); M10.6 part approved by owner 2026-11-12; M10.5 part approved by owner 2026-11-13 | 2026-11-12 | cd2cace30f4f |
| `src/components/listings/promotion-card.tsx`                    | visual | Letter-spaced capitals. Group 114: removes the 'Featured' badge and the boosted star (paid add-ons removed, group 98; no read carries them). | Event and advert cards without a price: the green line ('WED 11 NOV', the type) reads 'Wed 11 Nov' in normal letter spacing; same size, colour and place. Group 114: Nothing (the badge could not show) | keep     | approved by owner 2026-11-12 (M10.2); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 7c31014c028b |
| `src/components/organisations/performance-report.tsx`           | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Organisation performance report: the label above the title in sentence case, normal letter spacing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 052734c8ac2f |
| `src/components/organisations/sponsor-strip.tsx`                | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Mzansi Business sponsor band (shown when sponsors exist): 'PARTNERS' / 'BUSINESS SPONSORS' read 'Partners' / 'Business Sponsors'; same size and colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 6360e5800622 |
| `src/components/search/search-bar.tsx`                          | visual | Letter-spaced capitals.                                                                                                                                                                                                                                                                                                                                 | Search: the 'POPULAR' label before the quick searches reads 'Popular'; same size and colour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 9977c8182854 |
| `src/components/shared/official-social-links.tsx`               | visual | Letter-spaced capitals in the default title style.                                                                                                                                                                                                                                                                                                      | Nothing today: the footer and the contact page pass their own title style.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 042ba450b860 |
| `src/components/showrooms/carousel-item-transforms.ts`          | visual | The showroom wrote prices 'R 1 450', grid cards 'R1 450'; now the shared formatter.                                                                                                                                                                                                                                                                     | Showroom cards: 'R 1 450' reads 'R1 450', event tickets 'From R 150' read 'From R150'; a free market item says 'Free'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 2569991ac689 |
| `src/components/listings/price-consistency.test.tsx`            | test   | New: the same post's price reads the same on the grid card, list card, showroom card, home rail card, post page and immersive viewer, including Free, on request, negotiable and job salaries.                                                                                                                                                          | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | ff68f24bdcfe |
| `src/components/showrooms/carousel-item-transforms.test.ts`     | test   | Expects the shared price format ('R99', 'From R150').                                                                                                                                                                                                                                                                                                   | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-12 (M10.2)                                                                                   | 2026-11-12 | 0b177581e597 |

### 12. Content-first home (roadmap M10.3)

The home page opens on the showroom with nothing over it: the 'Launching soon'
pop-up is gone (since 18 November 2026 it is back: returned to the 27 Oct baseline at owner's request; reverses part of group 12; see Put back. Owner decision 18 November 2026: only the pop-up comes back; the rest of group 12 (the slim 'be the first' cards for empty areas and the slim 'Every poster ID-reviewed' line) is kept.), one slim line under the showroom says what is checked, and an
area with no posts shows one 'be the first' card instead of an empty rail. Six
rows elsewhere also carry M10.3 changes (`src/app/layout.tsx`,
`src/app/page.tsx`, `src/app/page.test.tsx` and the three home showcases); their
decision includes 'M10.3 part approved by owner 2026-11-12'.

| File                                                       | Kind   | Reason                                                                                                                                                                                                                             | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                    | Proposed | Owner decision                                                                    | Date       | Version      |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/components/home/home-identity-line.tsx`               | visual | New: the slim line that replaces the pop-up (owner decisions OD-05 and OD-15): one sentence on what is checked, under the showroom, so clients' posts stay first.                                                                  | Home page, straight under the showroom: a small rounded pill (the province chip's shape, which is hidden) with a green shield icon, 'Every poster ID-reviewed' and a green 'What we check' link to `/help/business-verification`, the page the footer's 'What we check' already opens.                                                                                                                                                    | keep     | approved by owner 2026-11-12 (M10.3)                                              | 2026-11-12 | b4f79409a303 |
| `src/components/home/home-showcase-empty-state.tsx`        | visual | An area with no posts showed a full rail: heading, summary, 'View all' and a large dashed 'No ... yet' box (owner decision OD-15: one 'be the first' card per area).                                                               | Home page, only for an area with no posts: one slim white card in the area's colour and icon (Market green bag, Business blue building, Tourism & Events teal palm), one line ('Be the first to sell on Mzansi Market', 'Be the first to add a business', 'Be the first to list a stay or event') and an arrow; the whole card opens that area's posting form, as the old button did. About 64 px tall on phones instead of about 330 px. | keep     | approved by owner 2026-11-12 (M10.3)                                              | 2026-11-12 | e71a16a63ada |
| `src/app/layout.test.tsx`                                  | test   | Expects the 'launching soon' pop-up in the app shell while its switch is on, and none when it is off or in Playwright runs (returned to the 27 Oct baseline at owner's request; reverses part of group 12). Earlier: expected no pop-up. | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M10.3); launching soon pop-up part: returned to the 27 Oct baseline at owner's request; reverses part of group 12 | 2026-11-18 | 38212a52ee08 |
| `src/components/layout/prelaunch-banner.tsx` | wording-behaviour | Returned to the 27 Oct baseline at owner's request; reverses part of group 12 (the rest of group 12 stays, owner decision 18 November 2026). One line changed at the owner's request: sign-up is invite-only and some features are hidden, so the old line overstated what visitors can do. Group 66: Keeps its look after the Button merge. | The 'We're launching soon.' pop-up shows again as in the chosen version (same look, heading, 'Explore the site' button and closing); its body line reads 'You're viewing an early preview of VerifyMzansi. Feel free to look around.' (chosen version: '... Everything already works, so feel free to look around and join in.'). Group 66: Nothing: 'Explore the site' keeps its gold in dark mode. | keep | approved by owner 2026-11-18 (pop-up back, honest wording); group 66 part approved by owner 2026-11-20 | 2026-11-20 | 4c9077ec5e83 |
| `src/components/home/home-business-showcase.test.tsx`      | test   | Expects the 'be the first' card (one link, no rail heading, no 'View all', no 'yet') when there are no businesses. Retired-backend removal: Runs on the new backend; retired-backend cases removed.                                | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M10.3); retired-backend removal part awaiting owner | 2026-11-12 | c1bd99ab9f5b |
| `src/components/home/home-mzansi-market-showcase.test.tsx` | test   | Expects the 'be the first' card when there are no listings. Retired-backend removal: Runs on the new backend; retired-backend cases removed.                                                                                       | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M10.3); retired-backend removal part awaiting owner | 2026-11-12 | 39f06450673a |
| `src/components/home/home-promotions-showcase.test.tsx`    | test   | Expects the 'be the first' card when there are no stays or events, and no card when there are. Retired-backend removal: Runs on the new backend; retired-backend cases removed.                                                    | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 (M10.3); retired-backend removal part awaiting owner | 2026-11-12 | 72b41250962a |

### 14. Title and price on the first phone screen (roadmap M10.6)

On phones a post opened on its photo and the contact bar; the title started
about 835 px down and the price after it. The showroom card's own caption
(price, title, pin and town) now sits on the post page's main photo below 768
px, for market posts, businesses and events, over shading that keeps the white
text at 7:1 or more even on a white photo. It repeats the page heading, so
screen readers skip it. Seven rows elsewhere also carry M10.6 changes; their
decision includes 'M10.6 part approved by owner 2026-11-12'. The automated
first-screen check is `e2e/foundation/post-first-screen.spec.ts`, on the
browser-test page below (its posts are in
`src/app/dev/post-first-screen/fixtures.ts`, outside the checked scope).

| File                                                      | Kind   | Reason                                                                                                                                                                                                             | What changes on screen                                                                                          | Proposed | Owner decision                       | Date       | Version      |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------ | ---------- | ------------ |
| `src/components/listings/poster-caption.tsx`              | visual | New: the showroom card's caption as one shared piece, used by the cards and by the three post pages, with the post pages' shading, video placement and short-screen frame height.                                  | Post pages on phones: the caption on the main photo (see the post page rows in groups 6 and 9). Cards: nothing. | keep     | approved by owner 2026-11-12 (M10.6) | 2026-11-12 | 8e43f73c1b80 |
| `src/app/dev/post-first-screen/page.tsx`                  | test   | New browser-test page: the three post pages' header, breadcrumbs and content on fixed posts, so the first phone screen is measured without a database. Test mode only; 404 in production (`src/proxy-handler.ts`). | Nothing (not part of the site)                                                                                  | keep     | approved by owner 2026-11-12 (M10.6) | 2026-11-12 | 44923e41ee61 |
| `src/app/listing/[id]/client.test.tsx`                    | test   | M10.6: tests the caption on the photo (hidden from screen readers, not a heading), its place above the video controls and its fading while the video plays.                                                        | Nothing (not part of a page)                                                                                    | keep     | approved by owner 2026-11-12 (M10.6) | 2026-11-12 | a0be7699a2d0 |
| `src/components/business/layouts/unified-layout.test.tsx` | test   | M10.6: the business name block now shows over a video on phones (it was expected to be absent there) and is hidden from screen readers.                                                                            | Nothing (not part of a page)                                                                                    | keep     | approved by owner 2026-11-12 (M10.6) | 2026-11-12 | aded29b90363 |

### 13. Business contact (roadmap M10.8)

Contacting a business takes no more taps than contacting a Market seller, and
the "are you human" check before a number fits a 320 px phone. Three rows
elsewhere also carry M10.8 changes: `content-contact-actions.tsx` (group 2),
`content-contact-actions.test.tsx` (group 5) and `unified-layout.tsx` (group 6);
their decision includes 'M10.8 part approved by owner 2026-11-12'.

| File                                                         | Kind              | Reason                                                                                                                                                                                      | What changes on screen                                                                                                                                                                                                                                                                                  | Proposed | Owner decision                                                     | Date       | Version      |
| ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ | ---------- | ------------ |
| `src/components/business/shared/sticky-contact-bar.tsx`      | wording-behaviour | The restored bar showed only for businesses with a number, so a business that only takes enquiries had no bar. It now falls back to the enquiry, in the bar's own button style.             | Business page on phones and tablets: a business without a public number shows the bottom bar with one green 'Send an enquiry' button (message icon); it opens the existing enquiry form, and closing the form returns focus to it. Businesses with numbers or a protected number see the bar as before. | keep     | approved by owner 2026-11-12 (M10.8)                               | 2026-11-12 | 0e45fc127d59 |
| `src/components/ui/turnstile-widget.tsx`                     | wording-behaviour | Callers can ask for the out-of-sight check; Cloudflare's 'flexible' widget is never narrower than 300 px, so in a narrower box it now renders compact. Group 61: an optional `action` prop passed to Turnstile, so the server can check a token was solved for this purpose (used by the view-and-like check only). | The check before a number: see `content-contact-actions.tsx`. The enquiry form's check on phones narrower than about 364 px (a 360 px Android, a 320 px phone): the 150 px compact box instead of a 300 px strip that stuck out of the form. Wider screens and every other form are unchanged. Group 61: nothing (no caller other than the view-and-like check sets it). | keep     | approved by owner 2026-11-12 (M10.8); group 61 part awaiting owner | 2026-11-19 | d2492fee4cb1 |
| `src/components/business/shared/sticky-contact-bar.test.tsx` | test              | Tests for the enquiry fallback and that numbers keep their buttons. Group 27: drops a mock of a deleted module.                                                                             | Nothing (not part of a page)                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-12 (M10.8); group 27 part awaiting owner | 2026-11-14 | e2f9d4908461 |
| `src/components/business/contact-tap-count.test.tsx`         | test              | New: counts the taps from a card to a sent message for a Market seller (4) and a business that takes enquiries (3, never more than the seller). Group 27: drops a mock of a deleted module. | Nothing (not part of a page)                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-12 (M10.8); group 27 part awaiting owner | 2026-11-14 | efefb34cd1a6 |

### 15. Sign-in and sign-up messages (owner request 2026-11-12)

The owner asked for the login and registration review's five gaps to be fixed.
Three are visible here; the others change only server code (new Google accounts
go to the phone step, like email sign-ups) or the database (the Google name is
saved at sign-up).

| File                                             | Kind              | Reason                                                                                                                         | What changes on screen                                                                                                                                                                                                                                                                                                    | Proposed | Owner decision               | Date       | Version      |
| ------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ---------- | ------------ |
| `src/components/ui/google-oauth-button.tsx`      | wording-behaviour | Google sign-up creates an account without the Terms box the email form has.                                                    | Sign-in and sign-up pages: under the Google button, one small line 'By continuing with Google, you agree to the Terms of Service and Privacy Policy.' with both links opening in a new tab.                                                                                                                               | keep     | approved by owner 2026-11-12 | 2026-11-12 | 744c498f6990 |
| `src/app/(auth)/login/page.tsx` | wording-behaviour | A refused or cancelled Google sign-in said 'Your sign-in link has expired', and an uninvited sign-up was told a link was sent. Group 63: a Google sign-up the sign-up hook refuses for its email domain (only while sign-up is open) gets its own message instead of the generic sign-in error. Group 71: the invite-only words: the 'Check your email' box after an invite-only sign-up and the Google sign-up refusal ('Sign-up is by invitation for now'). | Sign-in page: 'Sign-up is by invitation for now' with 'If you were invited, use the email address the invitation was sent to. Already have an account? Sign in with the email you used.' in the plain (white) message style when a Google sign-up is refused while sign-up is by invitation; 'Google sign-in was not completed' when it is cancelled; after an invite-only sign-up the 'Check your email' box reads 'VerifyMzansi is open by invitation for now. If this email was invited, we've sent it a confirmation link. Nothing there after a few minutes? Resend it, or sign up with the email address your invitation was sent to.' above its 'Resend confirmation' button. Group 63 (only once the owner opens sign-up): 'This email can't be used to register' with 'Sign up with a different email address or Google account.' when Google sign-up is refused for a blocked or reserved email domain. | keep | approved by owner 2026-11-12; group 63 part approved by owner 2026-11-20; group 71 part approved by owner 2026-11-21 | 2026-11-20 | 4c5c023ccc53 |
| `src/app/(auth)/register/page.tsx` | wording-behaviour | Every sign-up showed 'Account created!', even for addresses that cannot register yet. Group 71: while sign-up is by invitation, no message after 'Create account' (the sign-in page's 'Check your email' box says it once). | While sign-up is by invitation only, 'Create account' shows no message and goes straight to the sign-in page, whose 'Check your email' box gives the server's one answer (the same for every address, so it never shows who is invited or registered). An open sign-up still shows 'Account created!'. | keep | approved by owner 2026-11-12; group 71 part approved by owner 2026-11-21 | 2026-11-20 | 3042e2e261b5 |
| `src/components/ui/google-oauth-button.test.tsx` | test              | Tests that the Terms and Privacy line and its two links show under both Google buttons.                                        | Nothing (not part of a page)                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-12 | 2026-11-12 | 7ecacb998493 |
| `src/app/(auth)/login/page.test.tsx` | test | Tests for the invitation notice and the two Google sign-in messages. Group 63: also the blocked-domain message. Group 71: checks the new invite-only words. | Nothing (not part of a page) | keep | approved by owner 2026-11-12; group 63 part approved by owner 2026-11-20; group 71 part approved by owner 2026-11-21 | 2026-11-20 | 9df1a7a3a7c5 |

### 16. One terms step

The owner asked on 2026-11-12 for the posting terms to be accepted in one place
only: the tick box on each form, which records the acceptance with the post in
the same database transaction. The separate terms box that hid the section cards
on `/post/create` is removed. The Terms page row in group 2 also carries this
change.

| File                                                            | Kind              | Reason                                                                                     | What changes on screen                                                                                | Proposed | Owner decision                                | Date       | Version      |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------- | ---------- | ------------ |
| `src/app/post/create/page.tsx` | wording-behaviour | The page no longer waits for a separate terms acceptance before showing the section cards. Group 68: the signed-in check and the member's verification status come from the live backend (get_my_verification_case) instead of the old client and the retired verification tables, which always answered 'unverified'. Group 73: passes the signed-in account to the verification read, which refuses a decision about another account (no change on screen). Group 87 (SHOW_POST_TEMPLATES): reads the member's post templates and shows 'Start from a template' above the section cards when at least one exists and the Multi-listing package runs. Group 87 (review): the templates show whenever one exists, also after the package ends. | Pressing + Post shows the three section cards at once; no 'I agree to the current posting terms' box. Group 68: a verified member no longer sees 'Verification required before posting' for a moment before it goes away, and a member under review or turned down sees the right note at once (it used to show 'Finish verification to start posting.' until the browser asked again). Group 87 (switch on): 'Start from a template' with one card per template (Use, and a menu with Rename and Delete) and 'Or pick a section' above today's cards (picture bt-08). Group 87: after the package ends, the templates stay with Use turned off and the line "Your Multi-listing package has ended. Renew to use templates."; Rename and Delete still work. | keep | approved by owner 2026-11-12 (one terms step); group 68 part approved by owner 2026-11-20; group 73 part approved by owner 2026-11-21; group 87 part approved by owner 2026-11-22 | 2026-11-20 | e2a0ad516f7b |
| `src/components/posting/foundation-posting-terms-gate.tsx`      | wording-behaviour | Removed: the separate terms step before the section cards.                                 | See `src/app/post/create/page.tsx`.                                                                   | keep     | approved by owner 2026-11-12 (one terms step) | 2026-11-12 | deleted      |
| `src/components/posting/posting-terms-acceptance.tsx`           | wording-behaviour | Removed: the terms box used only by that step.                                             | See `src/app/post/create/page.tsx`.                                                                   | keep     | approved by owner 2026-11-12 (one terms step) | 2026-11-12 | deleted      |
| `src/components/posting/foundation-posting-terms-gate.test.tsx` | test              | Removed with the component it tested.                                                      | Nothing (not part of a page)                                                                          | keep     | approved by owner 2026-11-12 (one terms step) | 2026-11-12 | deleted      |
| `src/components/posting/posting-terms-acceptance.test.tsx`      | test              | Removed with the component it tested.                                                      | Nothing (not part of a page)                                                                          | keep     | approved by owner 2026-11-12 (one terms step) | 2026-11-12 | deleted      |

### 17. The Terms and paid plans paused (Pricing v2 P1)

Owner decisions of 12 November 2026: the site has one set of Terms (no version
names), switched today, and paid plans are paused until the R69 checkout is
built and tested; free posting keeps working. The Terms text
(`src/lib/legal/terms-documents/posting-v4.json`, outside the checked scope)
states the slot prices (R69 per Individual slot for each 30 days), the limits,
invoice payment above R10,000, the cooling-off consent, the refund and
cancellation policy (billing@verifymzansi.com), the free 7-day first post from
its approval and partner referral links; approved by the owner on 12
November 2026. The database switch takes every old plan off sale, so the pages
below show the R69 prices with nothing to buy. Nine rows elsewhere also carry
this change (billing FAQ, plan step, checkout page and confirmation, trial and
slot cards, multi-listing page, Advertise, pricing); their decision names the
pricing switch part. Text outside the checked scope with the same purpose: the
error messages in `src/lib/commercial/errors.ts` and
`src/lib/services/entitlements.ts`, the paused checkout reply
(`src/lib/billing/plan-sales.ts`) and the Terms page's fallback text
(`src/lib/legal/terms-text.ts`, the Terms word for word).

| File                                                  | Kind              | Reason                                                                                                                                                                                                                                     | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Proposed | Owner decision                                                                                                                         | Date       | Version      |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/terms/versions/[version]/page.tsx`           | wording-behaviour | Removed: the site has one set of Terms, shown at `/terms` with no version name (owner decision 2026-11-12).                                                                                                                                | The per-version Terms pages are gone; every `/terms/versions/...` address now leads to `/terms` (permanent redirect in the proxy).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | keep     | approved by owner 2026-11-12 (one set of Terms)                                                                                        | 2026-11-12 | deleted      |
| `src/components/billing/retail-pricing.tsx`           | wording-behaviour | Paid plans are paused until the R69 checkout (owner decision 2026-11-12): nothing may be bought at the old prices. Group 40: paid add-ons are hidden until they deliver (owner rule 2); the free post line uses the Terms' words. Group 98: the 'Urgent label add-on' line and its switch are removed (paid add-ons removed). | Pricing and billing plan cards: R69 / R207 / R414 (R69 per 30 days), no 'Popular', 'Best value' or 'Save' labels; with no plan on sale each card's button is a disabled 'Opens soon' and the line under the cards starts 'Paid slots open soon; your first post and events are free.'; the Tourism trial card reads 'Start free: 7 days' (no '30 days while places last'). R69 slots (group 18): the R69 slots are on sale, so each card's 'Choose 30 Days' / '90 Days' / '180 Days' button links to the Individual slot's checkout again (the same slot in every section) and the 'Opens soon' line goes; a test id on the price (no change on screen). Group 40: no 'Urgent label add-on' line on the plan cards; the Tourism free post card reads 'One free post per ID-reviewed person. No payment, nothing renews.' (was 'One free trial per verified person. ...'). Group 98: Pricing and billing plan cards: no 'Urgent label add-on' line. | keep     | approved by owner 2026-11-12; R69 slots part approved by owner 2026-11-12 (pricing switch); group 40 part approved by owner 2026-11-17; group 98 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 5d5c2da7719a |
| `src/components/billing/trial-policy.tsx`             | wording-behaviour | The 30-day launch trial has ended; the free post is 7 days from approval. Group 40: the free post is once per ID-reviewed person (Terms).                                                                                                  | Free post box on pricing and billing: '7 days from approval' (was '7 days, or 30 days while spaces last'). Group 40: 'One per ID-reviewed person.' (was 'One per verified member.').                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-12; group 40 part approved by owner 2026-11-17                                                               | 2026-11-17 | 1ffe0e94ab98 |
| `src/components/billing/multi-listing-nudge.tsx`      | wording-behaviour | Multi-listing is not on sale under the current Terms. Group 52: the hidden box states the package rules on sale (P4a) instead of the old plans. | The 'Need more posts live at once?' multi-listing box in the posting flow and on billing is hidden. Group 52: nothing today (hidden); when shown, the text reads 'A Multi-listing package keeps 5 to 250 posts live at the same time for 30, 90 or 180 days, at R100 per slot per 30 days. For dealers, agencies, shops and landlords.' (was '10 to 100 posts ... for 90 or 180 days, at a lower price per post'). | keep     | approved by owner 2026-11-12 (pricing switch); group 52 part awaiting owner | 2026-11-18 | f8a5896076be |
| `src/app/billing/page.tsx`                            | rewiring          | Tells the plan cards whether a plan is on sale. Group 68: the old commercial_settings read for the free-post days is removed; the trial texts use their fixed defaults, which is what production already showed (that read always failed on the live backend). Group 79: the VAT status in the billing answers is read from the database setting (api.get_vat_registration) instead of a fixed sentence. | Billing: the plan cards follow retail-pricing.tsx (R69 prices, 'Opens soon' while nothing is on sale); no multi-listing box (multi-listing-nudge.tsx). Group 68: Nothing on screen. (before and after pictures identical) Group 79: Nothing on screen today ('VAT status: not registered for VAT.' as before); the line is left out if the setting cannot be read. | keep     | approved by owner 2026-11-12 (pricing switch); group 68 part approved by owner 2026-11-20; group 79 part approved by owner 2026-11-21 | 2026-11-21 | 23082cc7bdcc |
| `src/components/listings/boost-button.tsx`            | wording-behaviour | The old price is gone. Group 98: the file is removed with the paid add-ons. | The unavailable Boost hint reads 'Boost is available on paid plans for this ...' (no '(from R50 / 30 days)'). Group 98: My posts: no Boost button. | keep     | approved by owner 2026-11-12 (pricing switch); group 98 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | deleted |
| `src/components/billing/multi-listing-plans.tsx`      | rewiring          | A code comment named the old R50 price. P4a (group 33): the package sizes and prices follow the owner's rules (R100 per slot per 30 days, from 5 slots, 30/90/180 days, R10,000 online).                                                   | Nothing (comment only) P4a (group 33): cards for 5, 10, 25, 50 and 100 slots with '<n> posts live at once · up to <4n> new posts per 30 days', the total for 30, 90 and 180 days and 'Choose <term>' (to the new package checkout), or 'By invoice' above R10,000; the note under them states the rules and 'Ask for an invoice' (email). Gone: '<n> live posts', 'R<x> per post per 30 days', 'Paid once online, nothing renews', 'named administrators', 'Request a quote'. Shown only where packages are shown (hidden while not on sale). Invoice choice: group 36.                                                                                                                                                                                                                                                                                                   | keep     | approved by owner 2026-11-12 (pricing switch); P4a part (group 33) approved by owner 2026-11-16; group 36 approved                     | 2026-11-17 | 21975096cdea |
| `src/app/advertise/page.test.tsx`                     | test              | Expects the paused prices, the hidden multi-listing package and the sponsor proposal without old fees. Group 40: expects the sponsor offer and add-ons hidden, the Terms' cancel answer and its link, 1 to 4 slots and the edit allowance. Group 52: no longer builds the old multi-listing plan table. Group 90: pins add-ons, the sponsor offer and package sales off, the branch these tests check (on in production). Group 98: no longer pins the removed add-on switch; still checks that Advertise names no Urgent, Boost or Featured. Group 114: checks the new 'Can I cancel?' answer. | Nothing (not part of a page) Group 114: Nothing (not part of a page) | keep     | approved by owner 2026-11-12; group 40 part approved by owner 2026-11-17; group 52 part awaiting owner; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 98 part approved by owner 2026-11-25 (answer: 'Approve them'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 0fb751ed592f |
| `src/components/billing/multi-listing-plans.test.tsx` | test              | Expects the multi-listing box to stay hidden while multi-listing is not on sale. P4a (group 33): tests for the new sizes, prices, the invoice line and the old wording gone. Group 90: pins package sales off for the nudge test (on in production). | Nothing (not part of a page) Invoice choice: group 36.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | keep     | approved by owner 2026-11-12; P4a part (group 33) approved by owner 2026-11-16; group 36 approved by owner 2026-11-17; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-17 | aee963cc8dbe |
| `src/app/billing/checkout/checkout-confirm.test.tsx`  | test              | Tests the confirmation page's paused note and its "not available" message. Group 96: checks the Terms and Refunds links before paying. | Nothing (not part of a page) R69 slots (group 18): tests the slot checkout: total, days, number of slots, the box and the three explanations. Renew early (group 32): tests renewing one slot and several, the renewal's own box, nothing to renew and an unpaid renewal. Invoice choice: group 36.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | keep     | approved by owner 2026-11-12; R69 slots part approved by owner 2026-11-13; renew early part approved by owner 2026-11-14; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups') | 2026-11-22 | 03d82858e295 |

### 18. R69 slots (Pricing v2 P2)

Owner decisions of 12 November 2026: paid slots reopen at R69 as soon as the
checkout is built and tested; the checkout requires the cooling-off box with 30
days preselected; no paid slot before the member's ID review is accepted (M3.8);
'My slots' (approved as an idea on 11 November 2026) is a new screen for the
owner's design approval. Five rows elsewhere also carry this change (checkout
page, confirmation and its tests, pricing cards, posting plan step); their
decision names the R69 slots part. Text outside the checked scope with the same
purpose: the checkout refusals in `src/lib/foundation/billing-runtime.ts` and
`src/lib/foundation/billing-route.ts`, and the checkout rules in
`src/lib/billing/slot-checkout.ts`.

| File                                             | Kind              | Reason                                                                                                                                                                                              | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Proposed | Owner decision                                                                                                                | Date       | Version      |
| ------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/dashboard/slots/page.tsx`               | visual            | New: the 'My slots' page (Pricing v2 P2, owner idea of 2026-11-11), read from the member's own slots in the new backend. P4a (group 33): reads the member's Multi-listing package beside the slots. | New page `/dashboard/slots`, phone first: 'My slots', the count 'N of 4 Individual slots' (with 'until <date>' for a staff-raised limit) and one 'Buy a slot' button (30 days), or 'Finish my ID review'; then one card per slot (see `my-slots.tsx`). If the slots cannot be read: 'Your slots cannot be shown right now. Please try again in a few minutes.' A signed-out visitor is sent to sign in; a refused account sees the dashboard's error page. P4a (group 33): with a package, its group is shown first (see `my-slots.tsx`); if the package cannot be read, the page shows the slots as before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | keep     | approved by owner 2026-11-13; P4a part (group 33) approved by owner 2026-11-16                                                | 2026-11-14 | 86c84ebce8c4 |
| `src/components/billing/my-slots.tsx` | visual | New: the cards of the 'My slots' page. P4a (group 33): the Multi-listing package as one group (owner's approved draft p4-07), and Individual slots beside it (E3). Group 62: tells the package card whether packages are on sale. Group 66: While the ID review is not done, finishing it is the main action. Group 93: names the new free credits source. | One card per slot: 'Individual slot' (or 'Free first post', 'Slot from VerifyMzansi', 'Paid by <sponsor>'), 'Ends <date>' and '<n> days left'; the post in it (opens its edit page) or 'Empty' with 'Create a post'; for 3 days after it ends, 'Ended' and the post's 'Hidden; kept until <date>'. Renew early (group 32): a 'Renew' button on each Individual slot from 14 days before it ends (before that, 'You can renew from <date>.'), 'Renew all' beside 'Buy a slot' when two or more can be renewed, 'Renewed until <date>' under the end date of a renewed slot, and a renewal waiting to start (when its slot's current days were refunded) shows 'Starts <date>' and 'Not started'. P4a (group 33): with a package: the package card first (see `my-slot-package.tsx`), then the heading 'Individual slots'; while the package runs, no 'Buy a slot' and no 'Renew' (they return in its last 7 days) and the line 'Individual slots run to their own end dates. New ones can't be bought while your package is active.'; a post shows 'Moves to a free package slot when it ends' (when the package has room) or 'Moving into your package'; 'Renewed until' shows only for a slot with a renewal queued. The package's own grant is not listed as a slot. Group 62: nothing by itself (see `my-slot-package.tsx`). Group 66: My slots, before the ID review is accepted: 'Finish my ID review' is filled green (was outlined); otherwise 'Buy a slot' green and 'Renew all' outlined as before. Group 93: a free credit's card is titled 'Free credits from VerifyMzansi: 1 post' (or 'N posts'), with a gift icon, 'Ends <date>' and days left; no Renew. | keep | approved by owner 2026-11-13; renew early part approved by owner 2026-11-14; P4a part (group 33) approved by owner 2026-11-16; group 62 part awaiting owner; group 66 part approved by owner 2026-11-20; group 93 part awaiting owner | 2026-11-22 | 0a8abd529cb1 |
| `src/components/dashboard/dashboard-sidebar.tsx` | wording-behaviour | The 'My slots' page needs an entry point. M6.2: the 'Performance' entry is hidden until it works (owner rule 2; OD-07): its page reads statistics the live backend does not record.                 | Dashboard menu (sidebar and the phone strip): 'My slots' (layers icon) after 'My posts'. M6.2: no 'Performance' entry in the dashboard menu (sidebar and the phone strip).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | keep     | approved by owner 2026-11-13 (My slots; M6.2 part)                                                                            | 2026-11-13 | e01630a264c7 |
| `src/components/billing/my-slots.test.tsx` | test | Tests for the 'My slots' cards. Group 66: Checks 'Finish my ID review' is the filled button. Group 93: checks the free credits card title. | Nothing (not part of a page) Renew early (group 32): tests Renew, Renew all, 'Renewed until', a renewal waiting to start and no renewing before the ID review. Group 66: Nothing (not part of a page) Group 93: Nothing (not part of a page) | keep | approved by owner 2026-11-13; renew early part approved by owner 2026-11-14; group 66 part approved by owner 2026-11-20; group 93 part awaiting owner | 2026-11-22 | 218dcd7db01a |
| `src/app/dashboard/slots/page.test.tsx`          | test              | Tests for the 'My slots' page: signed out, refused and outage. P4a (group 33): the package beside the slots, and the slots alone when it cannot be read.                                            | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | keep     | approved by owner 2026-11-13; P4a part (group 33) approved by owner 2026-11-16                                                | 2026-11-14 | c484155e9718 |

### 19. One tap opens any post (roadmap M10.5)

On touch screens a tap on a video card started the video and only a second tap
opened the post, while photo cards opened on the first tap. Now one tap opens
any post. The round play sign in the middle of a video card becomes a small
labelled 'Preview' button (44 px tall) that plays the video in the card, muted;
while it plays, the existing pause and sound buttons show. Only the showroom's
centre card may play by itself (after the visitor has pressed its Play once, as
before), and never when data saver, reduced data or reduced motion is on. Two
rows elsewhere also carry this change (`poster-card-shell.tsx`,
`listing-card-list.tsx`); their decision names the M10.5 part.

| File                                                 | Kind              | Reason                                                                                                                                                                                                                                                     | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                            | Proposed | Owner decision               | Date       | Version      |
| ---------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ---------- | ------------ |
| `src/components/ui/video-card-player.tsx`            | visual            | Touch-screen video cards no longer catch the whole card's tap to play; a labelled Preview button plays the video in place. The showroom's remembered Play choice no longer starts a video by itself when data saver, reduced data or reduced motion is on. | Phones and tablets (no mouse), on cards in Home rails, Mzansi Market, Mzansi Business, Tourism & Events, search and business pages: the round play sign in the middle of a video card becomes a dark pill with a play icon and the word 'Preview' (44 px tall, same colours); a tap anywhere else on the card opens the post. The pause and sound buttons look the same. Showroom centre card and computers: no change on screen. | keep     | approved by owner 2026-11-13 | 2026-11-13 | 3bb916e39c97 |
| `src/hooks/use-video-feed.ts`                        | wording-behaviour | Feed video cards never start by themselves; Preview plays only that card and does not switch on automatic playing for the other cards or the showroom; a preview stops when its card scrolls away or another card in its rail takes focus.                 | Phones and tablets: after pressing Play once, other video cards no longer start by themselves as they scroll into view; a preview stops when its card leaves the screen and does not restart by itself. Nothing changes in how cards look.                                                                                                                                                                                        | keep     | approved by owner 2026-11-13 | 2026-11-13 | a81717b620bd |
| `src/hooks/use-data-saver.ts`                        | wording-behaviour | Also honours the browser's 'reduced data' setting where supported, and offers one shared check used before any video starts by itself.                                                                                                                     | With 'reduced data' set in the browser, videos no longer start by themselves (as with data saver). Otherwise nothing.                                                                                                                                                                                                                                                                                                             | keep     | approved by owner 2026-11-13 | 2026-11-13 | faf513ca9560 |
| `src/stores/video-autoplay-store.ts`                 | helper            | Comment only: the remembered Play choice now belongs to the showroom alone.                                                                                                                                                                                | Nothing (comment only)                                                                                                                                                                                                                                                                                                                                                                                                            | keep     | approved by owner 2026-11-13 | 2026-11-13 | ad8996abd55d |
| `src/components/ui/video-card-player.test.tsx`       | test              | Tests that a tap on a touch-screen video card opens the post, that Preview is a real 44 px button that plays in place, and that data saver, reduced data and reduced motion stop the showroom card from playing by itself.                                 | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-13 | 2026-11-13 | 5588d37c354a |
| `src/hooks/use-video-feed.test.tsx`                  | test              | Tests that feed cards never play or load by themselves, that Preview plays only its card and leaves the showroom choice alone, and when a preview stops.                                                                                                   | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-13 | 2026-11-13 | 5607194664f3 |
| `src/hooks/use-data-saver.test.tsx`                  | test              | New: tests the Save-Data, reduced-data and reduced-motion checks.                                                                                                                                                                                          | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-13 | 2026-11-13 | a34e5ff0568e |
| `src/components/listings/poster-card-shell.test.tsx` | test              | Tests that one link covers a whole video card and that labels on the picture let taps through.                                                                                                                                                             | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-13 | 2026-11-13 | 6aeecdaa2ccf |

### 20. Staff fix paid but not delivered (roadmap M3.4)

Staff screens only, built inside the existing 'Payments & Refunds' page and its
'Recent payments' card (same card, badges, buttons and reason prompt). Owner
question 16. Text outside the checked scope with the same purpose: the refusal
messages in `src/lib/foundation/staff-payments.ts` and the route
`src/app/api/admin/commercial/route.ts`.

| File                                                      | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Proposed | Owner decision                                                                                                                                               | Date       | Version      |
| --------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------ |
| `src/app/admin/payments/page.tsx` | wording-behaviour | Native payments (guard capability `bi:view` to `payments:view`); now read from the staff list that carries each payment's delivery status, with the two staff work lists (M3.4). Retired-backend branch removed. P2b: shows the 'Record a bank transfer' card with the transfers waiting for a second staff member, and reads the bank transfer details of the listed payments. Group 28: reads the refunds through Ozow of the listed payments while OZOW_API_REFUNDS_ENABLED is on. Group 31: reads the latest invoices. Group 53: reads the open Multi-listing package invoice requests. Group 60: reads the Multi-listing package moves the sweep keeps failing to make. Group 79: reads the sales figures (api.get_staff_sales_summary). Group 100: shows the 'Add lost days' card to staff with the refund permission. Group 104: reads what is left to refund on the listed payments (api.get_staff_refunds_left). | Staff only: the Status filter gains 'needs attention (paid, not delivered)' and 'refund waiting for approval'; above the list, links 'N paid but not delivered: needs attention' and 'N refunds wait for approval' when there are any. P2b: the 'Record a bank transfer' card above 'Recent payments' (refund or transfer-confirmation permission, or any transfer waiting); if the bank transfer details cannot be read, 'Bank transfer details could not be loaded. Reload before refunding a payment.' Group 28 (only while refunds through Ozow are switched on): a 'Refunds that need staff' card above 'Recent payments'. Group 31: an 'Invoices' card below 'Record a bank transfer' (or 'Invoices could not be loaded. Reload the page.'). Expiry: group 45. Group 53: a 'Package invoice requests' card above 'Invoices' only while a member's request is open (nothing when it cannot be read; the failure is logged); none while packages are not on sale. Group 60: a 'Needs attention' card above 'Package invoice requests' only while a package move fails (nothing when it cannot be read; the failure is logged). Group 79: a 'Sales and VAT' card under the page title: sales of the last 12 months less refunds, the VAT status, the online checkout drop-off over 30 days and sales by product and term; a red 'VAT alert' line from R1.8 million; 'Sales figures could not be loaded. Reload the page.' when it cannot be read (the list still loads). Group 100: an 'Add lost days' card below 'Needs attention' (refund permission only). Group 104: nothing new on the page itself; the refund forms below use what is left to refund (when it cannot be read, the forms record whole refunds as before and the failure is logged). | keep | approved by owner 2026-11-13 (M3.4 and P2b); Ozow refunds part (group 28) approved by owner 2026-11-14; invoice part (group 31) approved by owner 2026-11-14; package invoice part (group 53) awaiting owner; package move part (group 60) approved by owner 2026-11-19; group 79 part approved by owner 2026-11-21; group 100 part approved by owner 2026-11-25 (answer: 'Approve both'); group 104 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 29350d2306fe |
| `src/components/admin/commercial/partners-panel.tsx` | wording-behaviour | Hides a sentence that does not apply when only retail plans are sold; the payments card shows delivery status, activation, refunds with Ozow's reference, single-slot refunds and the second approval (M3.4). Group 28: refunds through Ozow (sent by the server) and the separate dashboard record, only while switched on. Refund follow-ups: group 51. Group 54: partner rates are at most 20% (owner decision A2). Group 104: passes what is left to refund, the slots' dates and a first purchase to the refund forms. Group 109: keeps one request id per refund form until the refund is recorded; passes the notice end, the plan's term and the lost days to the refund forms, and what was refunded to the chargeback forms. | Staff only: the institutional-payments sentence is hidden when only retail plans are sold. Each payment: 'delivered' or 'not delivered' badge, 'Ref <merchant reference>', 'Activated by staff <date>'; 'Activate what was paid for' on a paid but undelivered payment; 'Record refund' / 'Record chargeback' open the refund form; an order of several slots lists 'Slot n · R69' with 'Refund this slot' and 'Slot chargeback'; a refund waiting for approval shows 'Approve refund' (greyed out for its requester) and 'Decline' / 'Withdraw'. Card text: 'Refund the money in Ozow first, then record it here with Ozow's reference.' P2b: a payment recorded from a bank transfer shows 'Bank transfer <reference>, cleared <date>' instead of 'Ref <merchant reference>', and its waiting refund 'Bank <reference>' instead of 'Ozow <reference>'. Group 28 (only while switched on): for payments paid through Ozow, 'Refund through Ozow' and 'Recorded in the Ozow dashboard' replace 'Record refund' ('Refund this slot through Ozow' and 'Slot recorded in the Ozow dashboard' per slot; chargebacks unchanged); each payment lists its Ozow refunds with their state; a refund through Ozow waiting for approval says 'sent through Ozow once approved' and has 'Approve and send to Ozow'; no refund buttons while one is on its way; the card text says a refund through Ozow takes effect when Ozow confirms it. Group 54: Staff only: 'Custom rate % (optional, up to 20%)'; the box takes 0 to 20 (was 50). Group 104: no new buttons; the refund forms opened from each payment and slot gain the amount and first-purchase fields of group 104. Group 109: nothing beyond the refund and chargeback forms' changes. | keep | approved by owner 2026-11-13 (M3.4 and P2b); Ozow refunds part (group 28) approved by owner 2026-11-14; group 54 part awaiting owner; group 104 part approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 9b2120ee5ac7 |
| `src/components/admin/commercial/payment-actions.tsx` | visual | New: the refund and chargeback form of a payment or one slot (M3.4). Refund follow-ups: groups 48 and 51. Group 104: part refunds and the first purchase. Group 109: a chargeback warns when part of the payment was already refunded; the request id comes from the payments list and is kept until the refund is recorded. | Staff only: in the payment's row, 'Refund of <payment or slot>: R… to the account that paid (<account>)' ('Above R1 000 returned on this payment: another staff member must approve it.', for refunds and chargebacks), a 'Reason' list (five reasons), 'Ozow refund reference' (required), 'Reason (audited)', 'Record refund' and 'Cancel'. P2b: for a payment recorded from a bank transfer the reference field reads 'Bank reference of the refund transfer' ('Bank chargeback reference'), placeholder 'From the bank's payment confirmation'. Group 104 (refunds only, when what is left can be read): the reason 'First purchase cancelled (within 5 business days)' (only for the whole payment of an account's first purchase), 'Left to refund: R…', 'Amount to refund (rand)', the unused-days line for a cancellation, 'Customer asked in writing on' for a first purchase, and 'The paid days end now…' or 'Only money goes back: the slot keeps running.' Group 109: 'Record chargeback' and 'Slot chargeback', when money was already returned on the payment (refunds and chargebacks together): 'Already returned R… on this payment. A chargeback returns the full amount again: check with Ozow or the bank before recording it.' under the heading line. | keep | approved by owner 2026-11-13 (M3.4 and P2b); group 104 part approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 9cf1f444aa4b |
| `src/components/admin/commercial/payments-panel.test.tsx` | test | Tests for the payments card: activation, the refund form, single-slot refunds and the second approval. Refund follow-ups: group 48 (the reasons offered and a record's new reason) and group 51 (the renewal reason and the 13 days). Group 104: part refunds, whole refunds as before, more than is left, and the first purchase. Group 109: the same request id after a lost answer (also from a reopened form) and a new one after success, the chargeback warning, the notice-end hint and the lost-days note. | Nothing (not part of a page) | keep | approved by owner 2026-11-13; group 104 part approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | acf94d1c25f0 |

### 21. Payment receipt email (roadmap M3.7)

Email only: no file in the checked scope changes, so this group has no file rows
(Files 0). Owner question 17. Decision: approved by owner 2026-11-13 (wording in
the pull request, approved as written). Text outside the checked scope: the
receipt email in `src/lib/services/payment-receipt-email.ts`, the fallback
'Payment received' notice in `src/lib/services/email.ts`, and the receipt read
in `src/lib/foundation/payment-receipt.ts`, sent once per settled payment by the
notification job in `src/lib/foundation/operation-jobs.ts`.

### 22. Hidden until it works, part 2 (roadmap M6.2)

Member features the live backend does not support yet are hidden in place (owner
rule 2; your decision OD-07: hide now, rebuild after launch). Nothing new is
added and nothing is restyled. They return when the live backend supports them;
the switches `SHOW_OWNER_METRICS` and `SHOW_LOCATION_DETECTION` are in
`src/lib/hidden-features.ts`. Three rows elsewhere also carry this change (the
verification page and its tests in groups 2 and 5, the dashboard menu in group
18); their decision names the M6.2 part. Owner question 18. Outside the checked
scope, with no change to any screen's design: a search lists tourism businesses
under Businesses again, as the chosen version did
(`src/lib/foundation/marketplace-read.ts`).

| File                                                  | Kind              | Reason                                                                                                                                                             | What changes on screen                                                                                                                                                                                                                                                                                                                                            | Proposed | Owner decision                                                                                        | Date       | Version      |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/dashboard/metrics/page.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07). The page reads view, lead and showroom statistics the live backend does not record, so every owner saw zeros. Group 57: 'and visitors see posts from their own province first' is removed from the 'Showroom turns' card: the showroom does not order posts by province (row A16). Group 81: the page reads its figures from the live backend's one owner read (api.get_my_post_performance, database update 20261121100028_post_performance_stats.sql) instead of the retired backend's tables; the layout, wording and order are unchanged. Group 88: the 'Showroom turns' card's text says what the fair showroom now does (owner-approved wording, plan section 6). | The 'Performance' page no longer opens: its address leads to the dashboard overview. Group 57: while the page is shown, the card reads 'Everyone gets an equal turn. Posts seen least go next, and new posts get 72 hours up front.' (the page is still hidden). Group 81: nothing today (still hidden); once on, every section shows real figures (see group 81). Group 88: nothing today (the page is still hidden); once shown, the card reads 'Every live post gets a fair turn. Posts seen least go next, new posts get a 3-day head start, and visitors see posts from their own city and province first, mixed with the rest of South Africa. Likes help a little but never jump the queue.' | keep | approved by owner 2026-11-13 (M6.2 hidden until it works); group 57 part awaiting owner; group 81 part approved by owner 2026-11-21; group 88 part awaiting owner | 2026-11-22 | 82f66fea4e76 |
| `src/app/help/showroom/page.tsx` | wording-behaviour | Hidden until it works (owner rule 2; OD-07). Its button led to the hidden 'Performance' page. Group 40: paid add-ons are hidden until they deliver (owner rule 2). Group 57: the 'Local first, never local only' rule, the 'How we know your province' section (network estimate and the 'Change' choice remembered on the device) and 'local posts first' in the page description and heading line are removed: the showroom does not order posts by province (row A16). Group 88: the rules match the fair showroom (plan section 6): the head start rule names the New tag and 3 days, 'Near you first, never only near you' is back with the city added, and 'Likes help a little' is new. Group 98: the 'Boost and Featured don't buy a better place here' wording and its switch are removed (paid add-ons removed). | The 'See your post's turns' button under the 'How the showroom works' heading is gone; the rest of the page is unchanged. Group 40: 'Everyone takes turns' reads 'Free or paid, every live post gets an equal turn at the front of the showroom. The posts that have been seen least this week go next.' (no 'Boost and Featured don't buy a better place here'). Group 57: 'How the showroom works' lists four rules instead of five (the 'Local first, never local only' card is gone); the 'How we know your province' section is gone; the line under the heading reads 'Fair turns for every post, and views counted honestly.' Group 88: 'How the showroom works' lists five rules: 'Everyone takes turns' (unchanged); 'New posts get a head start and a New tag for 3 days' ('For the first 3 days after a post first goes live, it carries a New tag and is moved forward, a little less each day. Editing or renewing a post does not make it new again.'); 'Near you first, never only near you' ('Of every 7 places, 3 go to posts from your city, 2 to the rest of your province and 2 to the rest of South Africa, so a post in a small town still reaches the big cities. We estimate your area from your internet connection for that page only and never store it. A post that has already had more than twice its fair share this week waits with the rest of South Africa.', map pin icon); 'A small nudge for video' (unchanged); 'Likes help a little' ('A post that more of its visitors like gets a small nudge within its turn. We count likes per view, so a new post is not behind a popular one, and likes never jump the queue.', heart icon). Group 98: How the showroom works: the first rule always reads 'Free or paid, every live post gets an equal turn at the front of the showroom. The posts that have been seen least this week go next.' | keep | approved by owner 2026-11-13 (M6.2 hidden until it works); group 40 part approved by owner 2026-11-17; group 57 part awaiting owner; group 88 part awaiting owner; group 98 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 9ab4ddbf7a87 |
| `src/components/dashboard/dashboard-sidebar.test.tsx` | test              | Checks that the 'Performance' entry is hidden on the sidebar and the phone strip. Group 90: now checks the 'Performance' entry is shown, on the sidebar and the phone strip. | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                      | keep     | approved by owner 2026-11-13 (M6.2 hidden until it works); group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-13 | 6ae8e5c08097 |

### 23. Phone-sized photos (roadmap M4.3)

Owner question 19. Decision: approved by owner 2026-11-13 (copies on;
`MEDIA_PHOTO_VARIANTS=off` is the switch if the free 5,000 monthly allowance
gets close). No file in the checked scope changes, so this group has no file
rows; the owner's sign-off covers what visitors download. Photos uploaded from
now on get 400, 800 and 1 600 px WebP copies beside the original (only widths
smaller than the original), made at upload with the free Cloudflare Images
binding that already re-saves every photo. Pages ask for the copy that fits the
screen; photos uploaded earlier, and any copy that is missing, show the original
as before. Screenshots before and after (phone and desktop, a showroom and a
post page) show no difference on screen. Files outside the checked scope:
`src/lib/image-loader.ts`, `src/lib/media/photo-variants.ts`,
`src/lib/utils/image-reencode.ts`, `src/lib/foundation/media-upload.ts` and
`src/app/api/media/serve/[...key]/route.ts`.

Each copy is one Images transformation. Images Free allows 5,000 a month, shared
with the re-save, so a large photo now uses 4 instead of 1 (about 1,250 large
photos a month instead of 5,000 before uploads stop until the next month). The
Worker setting `MEDIA_PHOTO_VARIANTS=off` stops making copies without a code
change; the paid Images plan (the owner's budget decision) removes the limit.

### 24. Staff record a bank transfer; a second staff member confirms it (Pricing v2 P2b)

Staff screens only, a new card on the existing 'Payments & Refunds' page in the
style of its other cards and forms. Owner question 21; approved by owner
2026-11-13. Four rows elsewhere also carry this change (the page in group 20,
the payments card and the refund form in group 20, the shared staff action
helper in group 3); their decision names the P2b part. Text outside the checked
scope with the same purpose: the refusal messages in
`src/lib/foundation/staff-payments.ts`, the route
`src/app/api/admin/commercial/route.ts` and the receipt read in
`src/lib/foundation/payment-receipt.ts` (a bank transfer's receipt shows the
customer's bank reference).

| File                                                          | Kind   | Reason                                                                                                                                                                                | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Proposed | Owner decision                                                                                                                                | Date       | Version      |
| ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/components/admin/commercial/bank-transfer-form.tsx`      | visual | New: staff record a cleared bank transfer, and a second staff member confirms or declines it (P2b); only confirmation starts the slots, sends the receipt and creates the commission. | Staff with the refund permission: a 'Record a bank transfer' card ('Only after the money has cleared in the bank account. Another staff member then confirms it; only then the customer's slots start and they get the receipt email.') with a button that opens the form: customer's account email, slot term, number of slots, 'Order total', amount received ('Not the order total' when it differs), date it cleared, bank reference, the written cooling-off waiver tick box, 'Reason (audited)', 'Record bank transfer' and 'Cancel'; a confirmation naming the customer and their slots. Above it, 'Waiting for a second staff member': each record with 'Confirm transfer' (off for its recorder, 'You recorded it: another staff member must confirm it.'), 'Decline' or 'Withdraw', and a red 'Possible duplicate' line when another record names the same customer, amount and date. Review fix (2026-11-14): a declined bank reference can be recorded again, so that line now reads 'Possible duplicate: N other record(s) have this bank reference and amount, or this customer, amount and date. Check the bank statement.' and also counts waiting or confirmed records with the same bank reference and amount on another day. When the last waiting transfer is confirmed, declined or withdrawn, its outcome message now stays on screen (it disappeared with the emptied list). Group 31: the customer's email field, the customer check, the slot term and number fields, the date it cleared, the bank reference and the waiver moved to `slot-order.tsx`, shared with the invoice forms (unchanged on screen); one new line under the title: 'Paid an invoice? Record the transfer on the invoice (open it under Invoices), so it pays the invoice.'. Expiry: group 45. | keep     | approved by owner 2026-11-13; review-fix wording (group 29) approved by owner 2026-11-14; group 31 line and move approved by owner 2026-11-14 | 2026-11-14 | a504232cdb6a |
| `src/components/admin/commercial/bank-transfer-form.test.tsx` | test   | Tests for the bank transfer form and the waiting list: the amount, the customer check, the confirmation, the recorder's switched-off Confirm, Withdraw and the request sent.          | Nothing (not part of a page). Expiry: group 45.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | keep     | approved by owner 2026-11-13                                                                                                                  | 2026-11-13 | 8bb8bd907f98 |

### 25. Communication choices saved (roadmap M1.7)

Owner question 20. The Notifications page (`/dashboard/communication`) keeps its
design; it now reads and saves through the live backend. Before, every visit
showed 'Failed to load email activity', saving a switch failed with 'Unable to
update preference' and every switch read off after a reload. Now the four
switches start off, stay as the member set them, and each change is kept with
its time and the switch wording (`communication-2026-11`); the Email tab lists
the member's own sent and failed account emails. Database update
`20261113134500_communication_choices_and_signup_terms.sql` also records which
Terms a new account accepted at sign-up (form or Google); nothing about that
shows on screen. Outside the checked scope: the two routes under
`src/app/api/communications/`, `src/lib/foundation/communication-choices.ts`,
`src/lib/foundation/restored-communication-route.ts` and
`src/lib/foundation/registration.ts`. The page component
(`src/components/dashboard/communication-hub.tsx`) is unchanged here; group 37
later hides two of its switches.

| File                                       | Kind     | Reason                                                                                                   | What changes on screen                                                                                              | Proposed | Owner decision                              | Date       | Version      |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------- | ---------- | ------------ |
| `src/app/dashboard/communication/page.tsx` | rewiring | The page reads the signed-in member from the live backend's session check instead of the retired client. | Nothing in its own layout; the page's switches and Email tab now work (see above): no error message on every visit. | keep     | approved by owner 2026-11-13 (M1.7 screens) | 2026-11-13 | 7af356e16fc6 |

### 26. Photo allowance and search pages (fixes to M4.3 and the merged business search)

Decision: awaiting owner. No file in the checked scope changes, so this group
has no file rows.

Photos (group 23 follow-up). Cloudflare Images Free includes 5,000 unique
transformations a month; past that, new ones fail with error 9422 until the next
month and nothing is charged
(https://developers.cloudflare.com/images/pricing/). The re-save every photo
needs for safety is one of them, so the three copies made since group 23 could
use up the month and then every photo upload failed. Now:

- only the 800 px WebP copy is made (one transformation instead of three), and
  only when the original is wider; pages ask for it for every image up to 800 px
  wide, and wider requests still ask for the 1 600 px copy (photos from group 23
  have it; newer ones get the original, as before group 23). Nothing looks
  different, but downloads change: newer photos on desktops and 3x phones load
  the full original again, and group 23 photos' small images load the 800 px
  copy instead of the 400 px one;
- the site keeps a rough monthly count in its existing KV namespace (photo and
  verification image re-saves and copies) and stops making copies at 3,000
  (60%), keeping the rest for re-saves; the photo then shows the original, as
  photos did before group 23. The count can run a little low when many photos
  are uploaded in the same minute; after the first refused re-save it is set to
  the full 5,000;
- a retried upload whose copy is already stored does not make it again;
- when the month's allowance is used up, nothing is stored and the member sees
  'Photo uploads are paused for now. Please try again later.' (posting and
  profile photo; was 'A file could not be uploaded. Check the format and storage
  allowance.'), and the Worker log carries an `images_allowance_exhausted` alert
  line.

About 3,500 photos a month can be uploaded (1,500 with a copy, then about 2,000
more without; fewer when verification images use some), instead of about 1,250
before uploads stopped. Photos from group 23 keep their 400, 800 and 1 600 px
copies and media cleanup still deletes them. `MEDIA_PHOTO_VARIANTS=off` still
stops copies at once. Files outside the checked scope:
`src/lib/image-loader.ts`, `src/lib/media/photo-variants.ts`,
`src/lib/media/images-allowance.ts`, `src/lib/utils/image-reencode.ts`,
`src/lib/foundation/media-upload.ts`,
`src/lib/foundation/verification-runtime.ts`,
`src/lib/business-verification/intake.ts`,
`src/lib/foundation/restored-avatar-route.ts`,
`src/app/api/media/upload/foundation.ts` and `wrangler.toml` (comments).

Business search. A text search under Businesses also reads tourism businesses
and merges both lists, reading at most 480 results of each. Its total counted
everything, so a search with more matches linked to pages that then failed. The
total is now capped to the whole pages within 480 (480 at 24 a page, 450 at 50 a
page), so every linked page loads, and a page past that shows no cards instead
of an error. A search with more matches says '480 businesses found'. File
outside the checked scope: `src/lib/foundation/marketplace-read.ts`.

### 27. Hidden until it works, part 3 (retired-backend cleanup)

Owner question 22. Staff pages and member buttons that still read the retired
backend are hidden in place (owner rule 2), as in groups 6 and 22: nothing new
is added and nothing is restyled, and none of them is ported. Hidden staff pages
send their address to the staff home; the routes behind hidden pages and buttons
answer 404. The switches are in `src/lib/hidden-features.ts`:
`SHOW_STAFF_COMMERCIAL_SETTINGS`, `SHOW_STAFF_TRIALS`, `SHOW_STAFF_PROGRAMMES`,
`SHOW_STAFF_OPERATIONS`, `SHOW_STAFF_INTELLIGENCE`, `SHOW_ORGANISATION_REPORT`,
`SHOW_ACCOUNT_DELETION`, `SHOW_TRIAL_PLAN_CHANGES` and
`SHOW_TRIAL_EXTENSION_OFFERS`. Three rows moved here from group 4; their earlier
decisions stand for their earlier changes. Seven rows elsewhere also carry this
change (the profile page, the trial card and five tests); their decision names
the group 27 part. Outside the checked scope with the same purpose: the staff
menu (`src/lib/admin/nav.ts`) and the routes `/api/admin/trials`,
`/api/admin/ops/jobs/retry`, `/api/organisations/<id>/report`,
`/api/account/delete`, `/api/trials` and `/api/trial-extensions/<id>`.

Group 57 (19 November 2026) deleted the Commercial settings, Free posts &
trials, Programmes & contracts and Intelligence pages, the trial plan changes
and the trial extension offers. Their rows moved there; the rows that stay here
carry a group 57 part.

| File                                               | Kind              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | What changes on screen                                                                                                                                                                                                                                                                                                                            | Proposed | Owner decision                                                                                                                                                                                                          | Date       | Version      |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ |
| `src/app/admin/operations/page.tsx` | wording-behaviour | Hidden until it works (owner rule 2). The page reads job, incident and retention records the live backend does not have, so it showed 'Operations health could not be loaded.' Group 70: the page reads the live backend's staff command (database update 20261120163500_staff_operations_health.sql) and shows late scheduled jobs, stuck emails and notices, payment problems, blocked deletions, evidence retention and open cost alarms; the old 'Retry job' button and its route are removed. Still off until launch (SHOW_STAFF_OPERATIONS). Group 81: the clean-up of old view records is its own scheduled job, so the table names it. | The 'Operations health' page no longer opens: its address leads to the staff home, and its menu entry is gone. Group 70: Nothing today (switch off). Once switched on at launch: four tiles 'Stuck emails', 'Stuck notices', 'Payment problems', 'Blocked deletions' (were 'Stuck jobs', 'Failed decision updates', 'Jobs waiting', 'Expiry job'); a 'Scheduled jobs' table listing 17 jobs with Last run and 'On time' or 'Late', each badge on one line (was inside 'Evidence retention', with a 'Failures (7 days)' column); new cards 'Stuck emails', 'Stuck notices' (with a grey line counting notices from the last 30 days that can never be sent), 'Payment problems' (with a link to Payments & Refunds) and 'Blocked deletions' (replacing 'Failed decision updates' and 'Stuck jobs' with its 'Retry job' button); 'Evidence retention' keeps its text and four figures; 'Open incidents' lists open cost alarms. Same cards, badges and layout as before. Group 81: an 18th row 'Old view records removed' (every minute) in 'Scheduled jobs'. | keep | awaiting owner; group 70 part approved by owner 2026-11-21; group 81 part approved by owner 2026-11-21 | 2026-11-20 | c9b0f6c41dd9 |
| `src/components/admin/home/decision-panels.tsx`    | wording-behaviour | The staff home linked to the hidden 'Operations health' page. The live backend does not send these figures yet, so the cards and rows read 'Unavailable'.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Admins and governors: the 'Decisions not applied' card ('Retry it from Operations health') is gone. Admins: the 'Open incidents', 'Stuck jobs', 'Evidence past purge date' and 'Expiry job' rows under 'Platform health' stay but no longer link anywhere.                                                                                        | keep     | awaiting owner                                                                                                                                                                                                          | 2026-11-14 | 2adf33922ca0 |
| `src/components/admin/home/attention.test.ts`      | test              | The staff home's urgent list leaves out items that link to the hidden 'Operations health' page. Group 90: now expects admins' urgent items to link to 'Operations health', with the stopped expiry job listed. | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                      | keep     | awaiting owner; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures')                                                                                                                                 | 2026-11-14 | 01313bbbc1c3 |
| `src/app/admin/organisations/[id]/page.tsx` | wording-behaviour | Native organisation workspace; admin rows show display name. Retired-backend branch removed. Group 27: the 'Offer a pilot extension' link led to the hidden 'Free posts & trials' page. Group 54: applicant contacts only for pending applications, on request; administrators by short name. Group 57: the hidden 'Offer a pilot extension' link and its switch are removed with the trial extension tools (row A18). | Staff only: on a founding-pilot organisation, the 'Offer a pilot extension' line under the programme status is gone; the rest of the page is unchanged. Group 54: Staff only: an applicant's business contact shows only while the application is pending, behind 'Show contact' (each reveal is logged) once the database update is applied (inline before it); administrators are named by their short name ('Thandeka D.'). Group 57: nothing (the link was hidden). | keep | awaiting owner (earlier changes keep their decisions: awaiting owner); group 54 part awaiting owner; group 57 part awaiting owner | 2026-11-19 | dd6f6cd59403 |
| `src/app/dashboard/organisation/[slug]/page.tsx` | wording-behaviour | Native workspace; performance report and offer are null in foundation; a failed offer read is now logged (M5.1). Native workspace; performance report and offer are null in foundation; a failed offer read was logged (M5.1). Retired-backend removal: retired-backend branch removed, and with it the offer read and its log line (the foundation path never read an offer). Group 27: hidden until it works (owner rule 2). The live backend has no programme report, so the 'Performance' tab held only its two CSV links, and both downloads failed. The trial extension offer card, which never showed, is behind its own switch. Group 40: the sponsor offer is on hold; its Advertise section is hidden, so the link to it is hidden (owner rule 2). Data minimisation: group 47 (applicant contacts on request). Group 57: the hidden trial extension offer card and its switch are removed (row A18). | Organisation admins: the 'Performance' tab and its 'Download report (CSV)' and 'Last 30 days (CSV)' links are gone; the Applications, Businesses and Profile & admins tabs are unchanged. Group 40: when a founding pilot has ended, no 'See programme prices' button (it led to the hidden sponsor section); 'Request a custom quotation' stays. Group 57: nothing (the card never showed). | keep | awaiting owner (earlier changes keep their decisions: awaiting owner (earlier change); M5.1 part approved by owner 2026-11-12; retired-backend removal part awaiting owner); group 40 part approved by owner 2026-11-17; group 57 part awaiting owner | 2026-11-19 | 4c65ac93e2a8 |

### 28. Staff refunds through Ozow

Staff screens only, shown only while `OZOW_API_REFUNDS_ENABLED` is on, built
inside the existing 'Payments & Refunds' page and its 'Recent payments' card
(same card, badges, buttons, form and reason prompt). Owner question 23;
approved by owner 2026-11-14 (still switched off). Two rows elsewhere also carry
this change (the page and the payments card in group 20). Text outside the
checked scope with the same purpose: the refusal messages in
`src/lib/foundation/ozow-refunds.ts` and `src/lib/foundation/staff-payments.ts`
and the route `src/app/api/admin/payments/ozow-refunds/route.ts`. Once refunds
went through Ozow, the 'Recorded in the Ozow dashboard' button also shows while
sending is switched off (typed references no longer refund Ozow payments).
Accepted for the owner: without the Ozow refund key set, a dashboard record
cannot be read back from Ozow, so it is only as reliable as the typed reference
it replaces.

| File                                                           | Kind   | Reason                                                                                                                                                               | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                       | Proposed | Owner decision               | Date       | Version      |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ---------- | ------------ |
| `src/components/admin/commercial/ozow-refund-actions.tsx` | visual | New: the refund through Ozow and the Ozow dashboard record forms, the approve and close buttons, each payment's Ozow refunds and the 'Refunds that need staff' card. Refund follow-ups: groups 48 and 51. Group 104: part refunds and the first purchase in both Ozow forms. Group 109: the request id comes from the payments list and is kept until the refund is recorded, so a form opened again after a lost answer never sends Ozow a second refund. | Staff only, while switched on: 'Refund through Ozow: <payment or slot>, R… to the account that paid (<account>)' with the reason list, 'Reason (audited)', 'Refund through Ozow' and 'Cancel'; 'Refund made in the Ozow dashboard' with 'Ozow refund id' and 'Record dashboard refund'; 'Approve and send to Ozow'; lines 'Ozow refund R… <state>'; the 'Refunds that need staff (N)' card with 'Close: never reached Ozow'. Group 104: the same amount and first-purchase fields as the reference form, in 'Refund through Ozow' and 'Refund made in the Ozow dashboard'. Group 109: nothing new of its own; the amount fields show the hint and lost-days note of refund-amount.tsx. | keep | approved by owner 2026-11-14; group 104 part approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 434679b9ee1d |
| `src/components/admin/commercial/ozow-refund-actions.test.tsx` | test   | Tests for refunds through Ozow: switched off, the request sent, the dashboard record, a refund in flight and closing. Refund follow-ups: group 51.                                                | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                 | keep     | approved by owner 2026-11-14 | 2026-11-13 | 69827973d14b |

### 29. Bank transfer and consent fixes

No file in the checked scope changes except the 'Possible duplicate' line of
`src/components/admin/commercial/bank-transfer-form.tsx` (its row stays in group
24, with the review-fix part awaiting the owner), so this group has no file rows
(Files 0). Owner question 24; approved by owner 2026-11-14. Review fixes
(2026-11-14, text outside the checked scope): the refund form's own refusals no
longer name Ozow ('Enter the refund reference.', 'The reference is 4 to 100
letters, digits, spaces or . _ : / -.'; a bank transfer refund reference may
have spaces, an Ozow one still not, with Ozow's wording from the database); 'A
bank transfer with that reference, amount and date is already waiting or
confirmed. Check the payments list before recording it.'; the receipt email's
'Date paid' is the day a bank transfer's money cleared, and a payment refunded
before its receipt goes out gets no receipt. On the communication page
(`src/lib/foundation/restored-communication-route.ts`) an ended session reads
'Your session has ended. Sign in again.', any other refusal 'Your account can't
change these settings right now', the email history 'Your account can't see its
email history right now'; only turning a choice on while restricted keeps 'Your
account can't turn this on right now'.

### 30. Video length and seller guidance (roadmap M4.4, part A)

Owner decision 11 Nov 2026 (`plans/pricing-2026-11-10.md` 8j): every video at
most 2 minutes, event videos at most 1 minute; the owner approved the guidance
wording. Awaiting the owner for the screens. Every video field (create and edit
forms, the business profile video) shows the guidance 'Up to 2 minutes (events:
1 minute), upright, 1080p, not 4K. Buyers decide in the first 15-30 seconds —
put the best part first.' in its help text, and checks the picked video's length
on the phone: a longer video is refused with its real length ('"clip.mp4": Your
video is 2 min 40 s; the limit is 2 minutes.'), a video whose length cannot be
read with '"clip.mp4": We couldn't read this video's length; please export it as
MP4.' A video that is converted anyway (a phone's MOV or WebM recording, which
often states no length) is measured after conversion instead. The same check
runs again at submit, because a Tourism & Events post can switch to an event
after the pick. The field's line 'Videos (MP4, WebM, MOV) up to 50 MB' becomes
'Videos (MP4, WebM, MOV)': a phone original up to 300 MB is now accepted, only
to be converted first; the stored file stays at most 50 MB. A failed conversion
says 'We couldn't convert this video. Film it in 720p or export it as MP4, then
try again.' Six rows in group 4 and four test rows in group 5 carry the same
change. Text outside the checked scope: `src/lib/media/video-length.ts`,
`src/lib/media/video-length-client.ts`,
`src/lib/media/compress-before-upload.ts`,
`src/app/post/_lib/video-fast-upload.ts`, `src/lib/foundation/media-upload.ts`
and `src/app/api/media/upload/foundation.ts` (the server stores MP4 only and
refuses a video over 2 minutes or without a readable length, with the same
messages; a WebM or MOV sent directly gets 'Videos are stored as MP4; please
export it as MP4 and try again').

| File                                      | Kind              | Reason                                                                                                                             | What changes on screen                                                                                                                                                                                                                                                                        | Proposed | Owner decision | Date       | Version      |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ---------- | ------------ |
| `src/components/ui/media-upload.tsx`      | wording-behaviour | M4.4a: video length rule checked on the phone (events 1 minute, others 2 minutes); larger phone originals accepted for conversion. | Video fields: the line under the button reads 'Videos (MP4, WebM, MOV)' (was '... up to 50 MB'); a video over the field's limit or with an unreadable length is not added and is listed under 'Some files were not added' with its real length; files up to 300 MB are accepted (were 50 MB). | keep     | awaiting owner | 2026-11-14 | 5206be912ffb |
| `src/components/ui/media-upload.test.tsx` | test              | M4.4a: 119 s accepted / 121 s refused, events 59 s / 61 s, unreadable length refused, a 120 MB original accepted for conversion. Group 76: a test that a 5 MB photo is accepted and one byte more is refused. | Nothing (not part of a page) Group 76: nothing. | keep     | awaiting owner; group 76 part awaiting owner | 2026-11-21 | 311308498d98 |

### 31. Customer invoices with Pay now (Pricing v2 P2b)

New screens. Members: an 'Invoices' page (`/billing/invoices`) and the invoice
itself (`/billing/invoices/<number>`), built from the existing card, badge,
button and checkbox styles of Billing and the checkout; they open only for the
signed-in account the invoice belongs to (anyone else gets 'not found'), and no
menu links to them yet: staff send the customer the link (owner question 26).
Staff: an 'Invoices' card on 'Payments & Refunds' in the style of its other
cards, and an invoice page (`/admin/payments/invoices/<number>`). Owner question
26; approved by owner 2026-11-14. Two rows elsewhere also carry this change (the
payments page in group 20 and the bank transfer form in group 24). Text outside
the checked scope with the same purpose: the refusal messages in
`src/lib/foundation/customer-invoices.ts`, the routes
`src/app/api/billing/invoices/route.ts` and
`src/app/api/admin/commercial/route.ts`. The seller's street address and the
bank transfer details appear only from Worker secrets the owner sets
(`src/lib/billing/invoice-settings.ts`); unset, the invoice leaves them out.

| File                                                             | Kind   | Reason                                                                                                                                                                                                                                 | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Proposed | Owner decision               | Date       | Version      |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- | ---------- | ------------ |
| `src/app/billing/invoices/page.tsx`                              | visual | New: the member's invoices (P2b).                                                                                                                                                                                                      | Signed-in members: 'Invoices', each invoice's number, what it is for, date, amount and 'Unpaid', 'Overdue', 'Paid', 'Paid, then refunded' or 'Cancelled', linking to the invoice; without invoices, 'You have no invoices. For a larger order paid by invoice, email billing@verifymzansi.com.'; when they cannot be read, 'Your invoices cannot be shown right now. Please try again in a few minutes.' Invoice choice: group 36.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | keep     | approved by owner 2026-11-14 | 2026-11-17 | 19b506c17406 |
| `src/app/billing/invoices/[number]/page.tsx`                     | visual | New: one invoice with its payment panel (P2b); only its owner can open it.                                                                                                                                                             | The invoice document and, beside it (below on phones), the payment panel. Anyone but the owner, or an unknown number: the not-found page. Invoice choice: group 36. Expiry: group 45. Group 117: the document and panel now come from the shared `invoice-with-pay-panel.tsx`; nothing changes on screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | keep     | approved by owner 2026-11-14; group 117 part approved by owner 2026-11-26 | 2026-11-17 | 46b3ecbe1f5c |
| `src/components/billing/invoice-document.tsx`                    | visual | New: the printable invoice (owner decisions: 'Invoice', never 'tax invoice'; not registered for VAT; reference = invoice number). Group 62: an added-slots invoice says the days added and the package's end. Group 96: CPA s26(3) totals: the total before tax and a VAT line. Group 117: also shown by the invoice payment link page; there the online payment line says Pay now is on this page. | 'Invoice', the number (VM-YYYY-NNNNNN) and its status; 'Date issued' and 'Due date'; 'From': Verifymzansi (Pty) Ltd, 'Registration number 2026/155305/07', the street address only when set, 'VerifyMzansi is not registered for VAT.'; 'Bill to': the customer's billing details or 'Billing details not added yet.'; a table 'Description', 'Quantity', 'Unit price', 'Amount' with 'Each slot runs N days from the day this invoice is paid.' and 'Total due' (or 'Total paid'); 'How to pay': Ozow with 'Pay now', 'The invoice number is your payment reference.', and only when the bank account is set, 'Or pay by bank transfer (EFT)' with account name, bank, account number, branch code and reference; once paid 'Paid on <date>. Thank you.', once void 'This invoice was cancelled and cannot be paid.' Invoice choice: group 36. Group 62: on an invoice for slots added to a package, the line reads '<n> days added. The slots run from the day this invoice is paid until the package ends on <date>.' instead of 'Each slot runs <n> days from the day this invoice is paid.' Group 96: invoice, above the total two rows: 'Total before VAT' with the amount and 'VAT' 'None'. Still titled 'Invoice'; 'VerifyMzansi is not registered for VAT.' unchanged. Group 117: on the invoice payment link page only, 'How to pay' reads 'Pay online with Ozow, straight from your bank: choose Pay now on this page. Your slots start ...' on screen; printed, and on every other page, it reads as before ('sign in at verifymzansi.com, open this invoice under Invoices and choose Pay now'). | keep     | approved by owner 2026-11-14; group 62 part awaiting owner; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 117 part approved by owner 2026-11-26 | 2026-11-26 | d2b2e73d0740 |
| `src/components/billing/invoice-pay-panel.tsx`                   | visual | New: billing details, the cooling-off box and Pay now (Ozow) next to the invoice; never printed. Group 117: on the invoice payment link page it sends to the payment link route, with the link's token instead of the invoice number. | 'Your billing details': 'Business or full name', 'Address', 'Company registration number (if you have one)', 'Save details' (later 'Change billing details'); 'Pay': the cooling-off box ('My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately.' with a 'Refunds' link), 'Pay now' (or 'Continue payment' while the Ozow page is open), off until the details are saved and the box is ticked ('Save your billing details first.' / 'You pay on Ozow's secure page, straight from your bank.'); the refusal in red; 'Print or save as PDF'. Paid or cancelled: printing only. While a bank transfer to the invoice is checked: 'Your bank transfer to this invoice is being checked. You do not need to pay again; your slots start once it is confirmed.' instead of the box and Pay now. See group 36. Expiry: group 45. Group 117: the same panel, unchanged, on the invoice payment link page. | keep     | approved by owner 2026-11-14; group 117 part approved by owner 2026-11-26 | 2026-11-26 | 088649444815 |
| `src/components/billing/print-button.tsx`                        | visual | New: the shared 'Print or save as PDF' button (browser print).                                                                                                                                                                         | 'Print or save as PDF' (hidden on paper).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | keep     | approved by owner 2026-11-14 | 2026-11-14 | 3efdca3388c3 |
| `src/app/admin/payments/invoices/[number]/page.tsx`              | visual | New: one invoice as staff see it (payments:view).                                                                                                                                                                                      | Staff: 'Invoice <number>', the customer (name and email), who issued it and why, 'The customer pays it here (signed in)' with the link, the Ozow payment attempts ('paying now'), when void its date and reason; in red, 'Paid twice: N other payment(s) of this invoice arrived after it was paid or voided. Nothing was delivered for it; refund it on Payments & Refunds (<payment ids>).'; for an unpaid invoice either 'A bank transfer to this invoice waits for a second staff member on Payments & Refunds. Confirming it pays the invoice.' or, with the refund permission, the 'Record a bank transfer to this invoice' card; the invoice document; 'Print or save as PDF'. Invoice choice: group 36.                                                                                                                                                                                    | keep     | approved by owner 2026-11-14 | 2026-11-17 | e821c3eff1fb |
| `src/components/admin/commercial/invoice-panel.tsx`              | visual | New: staff issue, list and void invoices (P2b), in the style of the bank transfer card.                                                                                                                                                | Staff: an 'Invoices' card ('Issue an invoice the customer pays online with Ozow from their invoice page. A bank transfer to the invoice number is recorded above.'); with the refund permission, 'Issue an invoice' opens the customer's account email, slot term, number of slots, 'Days to pay' (7), 'Invoice total', 'Reason (audited)', 'Issue invoice' and 'Cancel', a confirmation naming the customer ('Its number is kept even if it is voided later.') and 'Invoice <number> issued. Open it to copy the link for the customer.'; 'Latest invoices · N unpaid' with each number (link), amount, 'unpaid', 'paid' or 'void' ('paying now'), what for, customer, issue and due dates, and 'Void' (reason prompt) for an unpaid one with no bank transfer waiting; ' · bank transfer waiting' after 'unpaid' and, in red, 'Paid twice: refund the later payment (open the invoice).'         | keep     | approved by owner 2026-11-14 | 2026-11-14 | a1112975bf8b |
| `src/components/admin/commercial/invoice-transfer-form.tsx`      | visual | New: staff record a cleared bank transfer to an invoice (the invoice's customer, slots and amount); a second staff member's confirmation pays the invoice.                                                                             | Staff with the refund permission, on an unpaid invoice's page: 'Record a bank transfer to this invoice' ('Only after the money has cleared in the bank account. Another staff member then confirms it on Payments & Refunds; only then the invoice is paid and the slots start.'), 'Record a bank transfer' opens 'Date it cleared', 'Bank reference', the written waiver box, 'Reason (audited)', 'Record bank transfer' and 'Cancel'; 'Bank transfer recorded. It waits for another staff member to confirm it; the invoice is paid only then.'                                                                                                                                                                                                                                                                                                                                                  | keep     | approved by owner 2026-11-14 | 2026-11-14 | 078b8f76daa2 |
| `src/components/admin/commercial/invoice-transfer-form.test.tsx` | test   | Tests for the invoice bank transfer form: the request sent.                                                                                                                                                                            | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | keep     | approved by owner 2026-11-14 | 2026-11-14 | 20ff4edecfc8 |
| `src/components/admin/commercial/slot-order.tsx`                 | helper | Shared by the bank transfer and invoice forms: the customer's email field, the customer check, the slot term and number fields, the date it cleared, the bank reference and the waiver (moved from the bank transfer form, unchanged). | Nothing new (the same fields and messages as the bank transfer form)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | keep     | approved by owner 2026-11-14 | 2026-11-14 | 2519d7a0caab |
| `src/components/billing/invoice-document.test.tsx`               | test   | Tests for the invoice: no VAT line, seller and buyer, the bank section only when set, statuses. Group 62: checks the added-slots invoice line. Group 96: checks the 'Total before VAT' and 'VAT None' rows. Group 117: checks the payment link page wording and that printing keeps the usual words. | Nothing (not part of a page) Invoice choice: group 36.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | keep     | approved by owner 2026-11-14; group 62 part awaiting owner; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 117 part approved by owner 2026-11-26 | 2026-11-26 | 3d790f995ea5 |
| `src/components/billing/invoice-pay-panel.test.tsx`              | test   | Tests for the payment panel: consent before Pay now, billing details, refusals, printing. Group 117: through a payment link it posts the token, never the invoice number. | Nothing (not part of a page) Invoice choice: group 36. Expiry: group 45. | keep     | approved by owner 2026-11-14; group 117 part approved by owner 2026-11-26 | 2026-11-26 | d6bdced8a45e |
| `src/components/admin/commercial/invoice-panel.test.tsx`         | test   | Tests for the staff invoice card: the customer check, issuing with a request id, voiding, permissions.                                                                                                                                 | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | keep     | approved by owner 2026-11-14 | 2026-11-14 | f8bfb7a06d99 |

### 32. Renew early (Pricing v2 P3)

Every changed file in the checked scope already has a row elsewhere (the
checkout confirmation in group 2, the checkout page in group 4, the checkout
test in group 17, 'My slots' and its test in group 18), each with a renew-early
part approved by owner 2026-11-14, so this group has no file rows (Files 0).
Owner question 27; approved by owner 2026-11-14. Text outside the checked scope
with the same purpose: the reminder email (`src/lib/services/email.ts`: subject
'Your slot ends soon', the dated wording, 'Nothing renews automatically. ...'
and the 'Renew my slot' or 'Renew all' button), the renewal box
(`src/lib/billing/slot-checkout.ts`), and the renewal checkout's refusals
(`src/lib/foundation/billing-runtime.ts`: 'A slot can be renewed from 14 days
before it ends.', 'This slot cannot be renewed: it has ended or is not yours.
Buy a new slot instead.', 'You can renew only as many slots ahead as your slot
limit allows. Let a slot end before renewing another.', 'Your ID review must be
accepted before you renew a slot.') and the route's 'Tick the box to confirm
when your new days start.' (`src/lib/foundation/billing-route.ts`).

### 33. Multi-listing packages, part one (Pricing v2 P4a)

New screens, all hidden while packages are not on sale (the owner's switch in
the database, off until business tools P5-P7 pass): the 'Choose your package'
checkout (`/billing/package`, the owner's approved drafts p4-01 and p4-02 with a
typed number of slots) and the package group on 'My slots' (draft p4-07), built
from the existing checkout card, buttons, consent box and the deep-green brand
surface. Renew, Add slots and Team (shown on the draft) come with P4b-P4d; the
draft's photo grid is a list of post titles here (the package read carries no
pictures). Owner question 28: approved by the owner on 2026-11-16; the hidden
multi-listing page's team wording is still a follow-up before sales go on. Three
rows elsewhere also carry this change (the multi-listing page in group 4, the
plans box in group 17, 'My slots' and its page and test in group 18). Text
outside the checked scope with the same purpose: the package rules and checkout
box (`src/lib/billing/slot-packages.ts`: 'My slots start now; the 7-day
cooling-off does not apply because the service starts immediately.'), the
checkout's refusals (`src/lib/foundation/billing-runtime.ts`: 'Multi-listing
packages are not on sale yet.', 'Your ID review must be accepted before you buy
a package, so you never pay for days you cannot use.', 'Packages above 100 slots
or R10,000 are paid by invoice. Email billing@verifymzansi.com to ask for one.',
'This account already has a Multi-listing package. Its slots are on My slots.',
and for Individual slots while a package runs: 'While your Multi-listing package
runs, new posts use its slots: Individual slots cannot be bought or renewed
until its last 7 days.') and the route's 'Tick the box to confirm that your
slots start now.' (`src/lib/foundation/billing-route.ts`); `src/app/robots.ts`
keeps `/billing/package` out of search engines.

| File                                                 | Kind              | Reason                                                                                                                                                                                                                                                                                       | What changes on screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Proposed | Owner decision                                                           | Date       | Version      |
| ---------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ | ---------- | ------------ |
| `src/app/billing/package/page.tsx` | visual | New: the Multi-listing checkout page (P4a); not found while packages are not on sale. Group 60 (D6): reads the member's unpaid Individual slot invoices. Group 90: always shown; while packages are not on sale it shows the three fixed terms (30, 90, 180 days) with no plan. Group 114: tells the checkout when the package offer could not be read (not the same as not on sale). | New page `/billing/package` (opened from the multi-listing page with a size and term): the checkout below; a member whose ID review is not accepted, or who already has a package, sees why instead of the tick. Invoice choice: group 36. Group 60: see `package-checkout.tsx`. Group 114: See package-checkout.tsx in group 114. | keep | approved by owner 2026-11-16; group 60 part approved by owner 2026-11-19; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 1faa11e10a07 |
| `src/app/billing/package/package-checkout.tsx` | visual | New: 'Choose your package' (approved drafts p4-01 and p4-02, the owner's decisions 1-2: typed number of slots from 5). Group 53 (P4e, owner's decision 6 of 14 November): 'Ask for an invoice' sends the request to staff instead of opening an email. Group 60 (D6): a note about unpaid Individual slot invoices. Group 66: When the ID review blocks buying a package, going to it is the main action. Group 90: while packages are not on sale, 'Pay' is refused by the route and 'Ask for an invoice' shows 'Multi-listing packages are not on sale yet.' Group 96: the consent boxes link the Terms too (ECTA s43), through the shared `checkout-terms-links.tsx`. Group 114: says no VAT is charged under the total; when the package prices could not be read, says so and offers nothing to pay. | 'Multi-listing', 'Choose your package', the total with 'R100 per slot per 30 days'; 'Slots': a number box with - and + and the shortcuts 5, 10, 25, 50, 100, and under it 'Up to <n> slots for <term> can be paid online.' (or 'Packages start at 5 slots. For 1-4, use Individual slots (R69).'); 'Days': 30, 90, 180; 'Package details': Starts 'On payment', Ends '<term> later, all slots together (<date>)', Fair use 'Up to 4 posts going live per slot per 30 days', Renewal 'Does not renew automatically' (the draft's Team and Add slots later lines await P4c, P4b); the tick 'My slots start now; ...' with 'Refunds'; 'Pay R<total> securely'; above Ozow's maximum or 100 slots, no pay button but 'Ozow takes payments of up to R1 300, so this package is paid by invoice, at the same price. Ask for an invoice' (group 36); 'Back to pricing'. Group 53: above Ozow's maximum or 100 slots, Starts reads 'When your invoice is paid'; the invoice note sits in a gold box with a receipt icon (draft p4-02); under it the tick 'My slots start as soon as this invoice is paid; the 7-day cooling-off does not apply because the service starts immediately.' with 'Refunds', and the green button 'Ask for an invoice' (was the link that opened an email). After it: 'Invoice requested. We will let you know when it is ready; then pay it from Invoices.' Refusals show in the red box. Group 60: while the member has an unpaid Individual slot invoice, above the package details: 'You have an unpaid invoice for Individual slots (<number>). If you pay by bank transfer after your package starts, those slots run beside the package until their own end. See Invoices.' Group 66: Choose your package, while the ID review is not accepted: 'Go to my ID review' is filled green (was outlined). Nothing today: packages are not on sale. Group 96: after each consent text, 'Terms · Refunds' instead of 'Refunds'. Group 114: Choose your package: a small grey line 'No VAT is charged.' under the total. If the prices could not be loaded, the red message above the buttons reads 'We couldn't load package prices just now. Refresh the page or try again in a few minutes.' and Pay and Ask for an invoice stay disabled (was: 'Multi-listing packages are not on sale yet.' after pressing a button). | keep | approved by owner 2026-11-16; package invoice part (group 53) awaiting owner; unpaid invoice note (group 60) approved by owner 2026-11-19; group 66 part approved by owner 2026-11-20; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | c6017bf24535 |
| `src/components/billing/my-slot-package.tsx`         | visual            | New: the package group on 'My slots' (approved draft p4-07). Group 62: 'Add slots' on the package card (P4b). | A deep-green card: 'Multi-listing package', '<n> of <places> slots in use', 'Ends <date> · <n> days left', a gold bar, '<n> of <m> new posts used in the last 30 days'; then 'In your package' with each post (opens its edit page; 'Moved in from an Individual slot' for one the package took) and '<n> empty' with 'Create a post'. An ended package shows 'Ended', 'Ended <date>' and its posts' 'Hidden; kept until <date>'. Group 62: an 'Add slots' button (outline) under the new-posts line while packages are on sale and 7 or more whole days are left; it opens the 'Add slots' page. | keep     | approved by owner 2026-11-16; group 62 part awaiting owner | 2026-11-20 | 87c5e26fc263 |
| `src/components/billing/enterprise-pricing.tsx` | wording-behaviour | P4a: the multi-listing prices box inside the pricing page's package section now shows the new package sizes and prices (see `multi-listing-plans.tsx`). Group 40: the sponsor offer is on hold (owner rule 2), and the multi-listing card states the package rules (P4a), no administrators. Group 52: drops the unused old plan list it received. Group 66: The black button style is retired. | Nothing today: the pricing page's package section stays hidden while packages are not on sale; when shown, its 'Multi-listing plans' box has the new sizes and prices (its cards above still carry the old words until that section is reworked). Invoice choice: group 36. Group 40 (inside the hidden package section): no Business Sponsor card and no sponsor fee table or 'Request a sponsor proposal'; 'Two ways to advertise ...'; the Multi-listing card reads 'From R500 for 30 days' and 'From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days.' (was the old smallest plan price and '<n> to 100 live posts at once and 2 named administrators.'). Group 52: nothing. Group 66: 'Request a sponsor proposal' would be outlined instead of black; it shows only while the sponsor offer is on (off today), so nothing changes now. | keep | approved by owner 2026-11-16; group 40 part approved by owner 2026-11-17; group 52 part awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 0a20970194ca |
| `src/components/billing/enterprise-pricing.test.tsx` | test              | P4a: 'Choose' links go to the package checkout. Group 40: expects no sponsor card or fees and the package price on the Multi-listing card. Group 52: no longer builds the old multi-listing plan table. Group 90: pins the sponsor offer off, the branch these tests check (on in production). | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep     | approved by owner 2026-11-16; group 40 part approved by owner 2026-11-17; group 52 part awaiting owner; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-18 | 222e358e3195 |
| `src/app/billing/package/package-checkout.test.tsx` | test | Tests for the package checkout: typed number and bounds, prices per term, the invoice line, the tick, the request sent, refusals and an unpaid package. Group 53: the invoice request (tick, request sent once per order, success line, a refusal). Group 60: checks the unpaid invoice note. Group 90: checks the not-on-sale checkout (no plan, the refusal shown). Group 114: checks the VAT line and the prices-not-loaded message. | Nothing (not part of a page) Invoice choice: group 36. Group 53: nothing (not part of a page). Group 114: Nothing (not part of a page) | keep | approved by owner 2026-11-16; package invoice part (group 53) awaiting owner; group 60 part approved by owner 2026-11-19; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 111f2c74dc7d |
| `src/app/billing/package/page.test.tsx` | test | Tests for the package checkout page: not found while off, the size and term from the link, why a member cannot buy. Group 60: passes the member's unpaid Individual slot invoices, and none when they cannot be read. Group 90: the page is shown while packages are not on sale, with three terms and no plan. Group 114: checks the offer that could not be read. | Nothing (not part of a page) Group 114: Nothing (not part of a page) | keep | approved by owner 2026-11-16; group 60 part approved by owner 2026-11-19; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 616e41e8c503 |
| `src/app/pricing/multi-listing/page.test.tsx`        | test              | Tests for the multi-listing page: hidden while off; the new rules and none of the old ones. Group 40: expects the team point and the Advertise link hidden. Group 90: the page is always shown; the team point stays hidden and the Advertise link is shown. | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep     | approved by owner 2026-11-16; group 40 part approved by owner 2026-11-17; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-17 | b2d812ab326f |
| `src/components/billing/checkout-shell.tsx`          | helper            | P4a: the checkouts' frame (logo, 'Secure checkout' bar, patterned main area), shared by the slot checkout and the package checkout instead of a copy.                                                                                                                                        | Nothing (the same frame)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | keep     | approved by owner 2026-11-16                                             | 2026-11-14 | 813ea97c4d2d |
| `src/components/billing/pending-payment-actions.tsx` | helper            | P4a: an open payment's 'Continue payment', 'Check status' and 'Cancel pending payment', shared by both checkouts instead of a copy.                                                                                                                                                          | Nothing (the same buttons)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | keep     | approved by owner 2026-11-16                                             | 2026-11-14 | 88eb3f3709c9 |
| `src/components/billing/my-slots.package.test.tsx`   | test              | Tests for 'My slots' with a package: the group, Individual slots closed and reopened in the last 7 days, a post moving in, an ended package. Group 62: checks 'Add slots' shows only while on sale and 7 or more whole days are left. | Nothing (not part of a page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | keep     | approved by owner 2026-11-16; group 62 part awaiting owner | 2026-11-20 | 16d6f2ffb1ff |

### 34. Erased accounts in the staff payment screens (roadmap M1.6b)

Type-only change, so that the staff payment screens keep working once an account
is erased: its payments, bank transfers and invoices are kept with no account id
(owner decision OD-10). The account id of a payment (`partners-panel.tsx`), of a
refund form (`payment-actions.tsx`, `ozow-refund-actions.tsx`) and of a bank
transfer (`bank-transfer-form.tsx`) may now be empty; the data adapters
(`src/lib/foundation/staff-payments.ts`, `customer-invoices.ts`) accept it
instead of failing the whole page. Nothing changes on screen today (no account
has been erased); for an erased account the place of the account id stays empty.
Every changed file already has a row elsewhere (groups 20, 24 and 28), so this
group has no file rows (Files 0). Decision: approved by owner 2026-11-16 (owner
decision 7 on the erasure pull request).

### 35. Live-test fixes (17 November)

Fixes for problems found on the live site on 17 November. One is visible: on the
dashboard's 'Three steps to your first post', the verification step was ticked
(and read '(done)' to screen readers) while the ID was still in review; it is
now ticked only once verification is accepted, in the same words ('Verification
in review' until then, 'Verification approved' after). The rest changes nothing
on screen:

- Missing posts and organisations (`/listing/<id>`, `/mzansi-business/<id>`,
  `/tourism-events/<id>`, `/organisation/<slug>`) and the hidden multi-listing
  page answer a real HTTP 404 instead of 200, with the same 'not available' or
  'Page not found' page as before (the proxy decides before the page streams; no
  page file changes).
- `www.verifymzansi.com` moves permanently to `verifymzansi.com`.
- Public pages name their canonical address in the page head: the home page,
  Pricing, Privacy, Terms, Trust & Safety, PAIA, the two help pages and the two
  safety pages (rows below and the rows of `src/app/page.tsx`,
  `src/app/pricing/page.tsx`, `src/app/privacy/page.tsx`,
  `src/app/terms/page.tsx` and `src/app/help/business-verification/page.tsx`
  elsewhere).
- `/error` (where refused or failed staff and account checks land) is marked
  noindex (row of `src/app/error/page.tsx` and its test elsewhere).
- Signed-in pages: the notification bell (desktop and phone), the live toasts
  and the dashboard's lead badge and alerts share one request for the same data,
  and the bell's background refresh runs once a minute instead of every 10
  seconds, never while the tab is hidden (rows of
  `src/components/notification-bell.tsx`,
  `src/components/notifications/use-live-notification-listener.tsx` and
  `src/hooks/use-leads-unread.ts` elsewhere).
- The safety centre and the meeting checklist had identical 'Call SAPS 10111'
  and 'Call 112' buttons; they now share one component
  (`src/components/safety/emergency-call-links.tsx`), the same buttons.

Ten rows elsewhere carry the non-visible part of this change; their earlier
decisions stand for their earlier changes. Proposed: keep. Decision: awaiting
owner.

| File                                                     | Kind              | Reason                                                                                                                                                                              | What changes on screen                                                                                                                                                                                                         | Proposed | Owner decision | Date       | Version      |
| -------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------- | ---------- | ------------ |
| `src/components/dashboard/dashboard-onboarding.tsx` | wording-behaviour | Live-test fix: the first step was ticked (done) while the ID was still in review. Group 66: The dashboard banner already has 'New post'. | Dashboard, 'Three steps to your first post': while the ID is in review the first step reads 'Verification in review' with its number 1, not a tick; it is ticked ('Verification approved') only once verification is accepted. Group 66: Dashboard with no posts: the 'Create your first post' button beside 'You haven't posted yet' is gone; the three steps (with 'Post your first item') are unchanged. | keep | awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 276d2b9594cf |
| `src/components/dashboard/dashboard-onboarding.test.tsx` | test | Tests the verification step: open while in review, done once accepted. Group 66: Checks there is no second post button. | Nothing (not part of a page) Group 66: Nothing (not part of a page) | keep | awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 343a5af55050 |
| `src/components/notification-bell.test.tsx`              | test              | Live-test fix: the desktop and phone bells share one request and one timer (once a minute, not while the tab is hidden).                                                            | Nothing (not part of a page)                                                                                                                                                                                                   | keep     | awaiting owner | 2026-11-17 | 470bcf420bbc |
| `src/app/trust-safety/page.tsx` | rewiring | Live-test fix: names its canonical address (`/trust-safety`) in the page head. Group 66: 'Report a concern' is the main action; gold on the dark band. Group 79: the 'VAT status' line is read from the database setting (api.get_vat_registration) instead of a fixed sentence. Group 96 (no change to this file): the shared company details no longer carry the registered street address. Group 101: the ID step's wording is true on every ID check setting (staff or Didit). | Nothing on screen Group 66: Trust & Safety hero: 'Report a concern' first and gold (was second and outlined), 'Safety tips' second and outlined (was first and green). Group 79: Nothing on screen today ('VAT status: not registered for VAT' as before); the line is left out if the setting cannot be read. Group 96: the 'Registered address' row is gone from the company details. Group 101: Trust & Safety 'How someone gets verified', step 2 'ID & selfie reviewed' reads 'Checked by our team or our verification partner, then encrypted.' (was 'Reviewed by our team, then encrypted.'). | keep | awaiting owner; group 66 part approved by owner 2026-11-20; group 79 part approved by owner 2026-11-21; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 4b2274862b6c |
| `src/app/paia/page.tsx` | rewiring | Live-test fix: names its canonical address (`/paia`) in the page head. Group 61: the visitors' line matches what view and like counting stores. Group 96: the sections of the Information Regulator's PAIA manual template that were missing. Group 101: the recipients match what the system uses (settled legal answers D2, D3). | Nothing on screen Group 61: 'Visitors: device and browser data, a random browser identifier and a hashed network address used for view counting' becomes '... and a random browser identifier, stored only as a keyed hash, used for view and like counting'. Group 96: PAIA manual, 'Legal identity' becomes 'Company and contact details' with one row 'Director and Information Officer' (was 'Responsible officer' and 'Information Officer', the same name twice), Information Officer phone and email, Deputy Information Officer ('None appointed'), Physical address ('Our registered address, as recorded at CIPC'; the registration number is shown once, in its own row), Postal address ('Same as the registered address'), General email and Website, and without the 'Registered address' row with the street address; new sections 'Abbreviations' (first: CIPC, PAIA, POPIA) and 'Updates to this manual' (last); the purpose section adds that a copy goes to anyone who asks and to the Information Regulator; cross-border transfers name the United Kingdom, the European Union, the United States and Kenya; 'Updated November 2026'. Group 101: PAIA 'How we process personal information': the recipients line names Supabase (database and sign-in), Cloudflare (hosting, file storage, security and bot protection), Didit (ID and face checks), Resend (email), Zoho (our email inbox), Africa's Talking (SMS codes), Sentry (error monitoring) and Google (sign-in with Google, if you choose it), then 'Ozow receives payment details to process payments.' (was: Supabase with file storage, no Didit, Zoho or Google, Ozow listed as an operator). | keep | awaiting owner; group 61 part awaiting owner; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | bcbe685ffcc6 |
| `src/app/help/verification/page.tsx` | rewiring | Live-test fix: names its canonical address (`/help/verification`) in the page head. Group 66: The main button on a dark-green band is gold. Group 69: camera-only help (in-app browsers, Continue on your phone; no 'upload a clear image file'). | Nothing on screen Group 66: Verification help: 'Continue verification' in the dark-green hero is gold instead of green. Group 69: two new help cards and the line 'Photos are taken with the camera on the verification page...'. | keep | awaiting owner; group 66 part approved by owner 2026-11-20; group 69 part approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | 45a2721b046f |
| `src/app/safety/meeting-checklist/page.tsx`              | rewiring          | Live-test fix: names its canonical address (`/safety/meeting-checklist`) in the page head. Its emergency band's two call buttons now come from `EmergencyCallLinks` (same buttons). | Nothing on screen                                                                                                                                                                                                              | keep     | awaiting owner | 2026-11-17 | 4f0f8f95c0a6 |
| `src/app/safety/scam-alerts/page.tsx`                    | rewiring          | Live-test fix: names its canonical address (`/safety/scam-alerts`) in the page head.                                                                                                | Nothing on screen                                                                                                                                                                                                              | keep     | awaiting owner | 2026-11-17 | c5843debc9a5 |
| `src/components/safety/emergency-call-links.tsx`         | helper            | Live-test follow-up: the 'Call SAPS 10111' and 'Call 112' buttons the safety centre and the meeting checklist both had, shared instead of copied (duplication check).               | Nothing (the same buttons)                                                                                                                                                                                                     | keep     | awaiting owner | 2026-11-17 | d0d4082fc5e9 |
| `src/app/safety/page.tsx` | helper | Live-test follow-up: its emergency band's two call buttons come from `EmergencyCallLinks` instead of a copy. Group 66: 'Report a problem' was filled green twice; owner sign-off 20 Nov with 3 follow-ups: the hero's one sits on a dark-green band, so it is gold. The red 'Call SAPS 10111' stays filled (emergency exception, code comment). | Nothing (the same buttons) Group 66: Safety Centre: the hero's 'Report a problem' is gold (the dashboard banner's gold, dark words) instead of green and stays the main button; the red 'Call SAPS 10111' is unchanged; the one under 'Reports, disputes, and appeals' is a green underlined text link beside the outlined 'Appeal a decision'. | keep | awaiting owner; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 127dad7e3c51 |

### 36. Invoice choice and Ozow's maximum

Every changed file in the checked scope already has a row elsewhere: the
checkout confirmation (group 2), the checkout page and the price pages (group
4), the checkout test and the Multi-listing plans and their test (group 17 and
33), the invoices page, the invoice page, the payment panel, the invoice
document, their tests and the staff invoice page (group 31), and the package
checkout, its page and test and the business pricing card (group 33). Their
invoice-choice part was approved by the owner on 2026-11-17 (owner question 29),
so this group has no file rows (Files 0); each row says 'Invoice choice: group
36' where the cell has room. What changes on screen:

- Checkout: 'Need an invoice before you pay? Get an invoice' below Pay (not on a
  renewal, nor while the ID review or slot limit notice shows); opened: 'We
  email you an invoice for this order. Pay it with Pay now (Ozow) or by bank
  transfer; your slots start once it is paid.', 'Email us for the invoice' and
  'Send it from your account's email address. You add your business details on
  the invoice.' Above Ozow's maximum the box and Pay give way to 'Ozow takes
  payments of up to R1 300. For this order, get an invoice and pay it by bank
  transfer.', the green 'Email us for the invoice' button and 'Send it from your
  account's email address.' (no 'You'll pay on Ozow's secure page.'); a renewal
  above it: 'Ozow takes payments of up to R1 300. Untick some slots and renew
  them in a second payment.' with Pay off. The R10,000 note is gone.
- Invoices: without invoices, 'You have no invoices. Need one before you pay?
  Choose Get an invoice at checkout, or email billing@verifymzansi.com.'; above
  Ozow's maximum the payment panel reads 'Ozow takes payments of up to R1 300,
  so pay this invoice by bank transfer. Use the bank details on the invoice and
  its number as your reference; your slots start once the money has cleared.'
  and the invoice's 'How to pay' reads 'Pay by bank transfer (EFT): Ozow takes
  payments of up to R1 300.00, so this invoice cannot be paid online. The
  invoice number is your payment reference.' with the box 'Bank transfer (EFT)'
  (staff see the same invoice).
- Packages: the package checkout and the price lists use Ozow's maximum instead
  of R10,000 ('Ozow takes payments of up to R1 300, so this package is paid by
  invoice, at the same price.'; 'Up to 13 slots for 30 days can be paid online.'
  or 'A package for 90 days is paid by invoice.'; 'By invoice' on the price
  cards); the note reads 'Paid online up to the most our payment provider, Ozow,
  accepts in one payment; more than that, or more than 100 slots, by invoice at
  the same price.'

Text outside the checked scope with the same purpose: the invoice email
(`invoiceRequestHref` in `src/lib/billing/slot-checkout.ts`: subject 'Invoice
for slots', 'Please send me an invoice for:', '<n> Individual slots, <days>
each', 'Total: <amount>', 'I confirm: My slots start as soon as this invoice is
paid; the 7-day cooling-off does not apply because the service starts
immediately.', 'I am sending this from the email address of my VerifyMzansi
account.'), the refusals in `src/lib/foundation/billing-runtime.ts` and
`src/lib/foundation/customer-invoices.ts`, and the Terms posting-v5
(`src/lib/legal/terms-documents/posting-v5.json`).

### 37. Hidden until it works, part 4: Analytics and Third-party sharing (roadmap M1.7)

Owner decision 2026-11-16 (owner rule 2): the 'Analytics' and 'Third-party
sharing' switches on the Notifications page's Preferences tab
(`/dashboard/communication`, group 25) are hidden, because the site does not use
usage analytics or third-party processing yet. Nothing new is added and nothing
is restyled; 'Marketing email' and 'Marketing SMS' work as before, and their
saving and history are unchanged. The switch `SHOW_DATA_USE_CHOICES` is in
`src/lib/hidden-features.ts`. Outside the checked scope, with no change on
screen: while the switch is off, the preferences route
(`src/lib/foundation/communication-choices.ts`) refuses a request that turns
either choice on ('Check the details and try again') and still accepts turning
one off, so a member who chose one earlier can withdraw it.

Group 57 (19 November 2026) deleted the two switches and `SHOW_DATA_USE_CHOICES`
instead of keeping them hidden; both rows carry a group 57 part.

| File                                                  | Kind              | Reason                                                                                                                                                                  | What changes on screen                                                                                                                                  | Proposed | Owner decision                                    | Date       | Version      |
| ----------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- | ---------- | ------------ |
| `src/components/dashboard/communication-hub.tsx` | wording-behaviour | Hidden until it works (owner rule 2). The site does not use usage analytics or third-party processing yet, so the two switches asked for a choice that changed nothing. Group 57: removed, not hidden (owner decision 19 November 2026, row A20): the two switches and their switch are deleted, and the card no longer mentions data use. | Notifications page, Preferences tab: the 'Analytics' and 'Third-party sharing' switches are gone; 'Marketing email' and 'Marketing SMS' stay as before. Group 57: the Preferences card's line under 'Your preferences' reads 'Optional messages.' (was 'Optional messages and data use.'). | keep | hidden until it works (owner decision 2026-11-16); group 57 part awaiting owner | 2026-11-19 | 76de0206dab0 |
| `src/components/dashboard/communication-hub.test.tsx` | test | Checks that the Preferences tab shows the two marketing switches and hides 'Analytics' and 'Third-party sharing'. Group 57: tests follow the removals (no hidden-state checks of removed code; no visitor province passed to the showroom). | Nothing (not part of a page). Group 57: nothing. | keep | hidden until it works (owner decision 2026-11-16); group 57 part awaiting owner | 2026-11-19 | 2dc3a635acf5 |

### 39. Claim a case before viewing its ID documents

Live-test fix (17 November). On the staff ID check queue
(`/admin/verification`), 'View documents' on a case the staff member had not
claimed opened the comparison and failed with a refusal: the server shows ID
documents only to the staff member holding the case's 30-minute claim ('Claim
next 10'). The page already knows who holds each claim, so the button now waits
for it:

- 'View documents' is greyed out, with 'Claim this case first' under it, until
  the viewer holds the case's claim (also when a colleague holds it; the row
  below already names them).
- Each row's 'View' (ID or selfie) is greyed out the same way; the row already
  shows 'Claim items from the queue to decide them'.

Nothing changes for a case the viewer has claimed, and the server's checks are
unchanged. Business verification (`/admin/business-verification`) is not
changed: there a file can also be opened by the assigned or deciding reviewer
without a claim, and a refusal already shows inline next to the file.

The one changed file, `src/components/admin/kyc-queue-table.tsx`, already has a
row in group 3, so this group has no file rows (Files 0); that row says 'Claim
first: group 39' and its earlier decision stands for its earlier change. Tests:
`src/__tests__/kyc-queue-table.test.tsx` (outside the checked scope). Proposed:
keep. Decision: awaiting owner.

### 40. The site matches the Terms (posting-v5)

The public pages promised things the Terms (posting-v5) or the live product do
not. Features that do not work yet are hidden in place (owner rule 2), with
their switches in `src/lib/hidden-features.ts`: `SHOW_SPONSOR_OFFER` (the
sponsor programme is on hold by the owner's decision and the Terms sell no
sponsor package), `SHOW_PAID_ADDONS` (add-on sales are paused and paid add-ons
do not deliver yet, roadmap M1.10) and `SHOW_PACKAGE_TEAMS` (package teams,
P4c). Wording that was wrong now states the Terms or the live backend. Nothing
is restyled. Every changed file in the checked scope but one already has a row
elsewhere (Advertise and its test, the Multi-listing page and its test, Business
Sponsors, the home sponsor band, the showroom help page, an organisation's
dashboard, the pricing package block and its test, the billing answers, the plan
cards, the free post card and the posting plan box); each of those rows says
'Group 40' and its decision 'group 40 part approved by owner 2026-11-17'. The
one new row is below. Owner question 30: approved by the owner on 2026-11-17.
What changes on screen:

- Advertise, 'Can I cancel?': was 'Yes, you can take your post down at any time.
  Unused days are not refunded. We refund rejected posts, duplicate charges and
  billing errors, and your statutory cooling-off rights apply.'; now 'You can
  take your post down at any time. Before you pay, you agree that your slot
  starts as soon as your payment is confirmed, so the 7-day cooling-off does not
  apply and a change of mind is not a reason for a refund. A rejected post keeps
  its slot: correct it and submit it again. If we wrongly reject a post, a paid
  slot does not work, or the site is down for more than 24 hours in a row, we
  first add the days you lost; if you still ask, we refund a reasonable part of
  the price for those days. If you are an individual (sole traders included),
  you can cancel a slot by emailing billing@verifymzansi.com from your account's
  email address. The slot runs for 20 more business days, then we credit its
  unused whole days, less a R50 fee; if that is R0 or less, nothing is paid, so
  cancelling a 30-day slot usually returns nothing. Closing your account cancels
  all your slots. Companies and other organisations are not refunded for unused
  days. Billing errors and duplicate payments are refunded in full once we have
  checked them. Refunds go to the account that paid, within 30 days after we
  approve them. Your rights under the Consumer Protection Act are not affected.
  Refunds & cancelling in the Terms.' (the last words link to `/terms#refunds`;
  Terms: Paying, VAT & invoices; Refunds & cancelling).
- Advertise, Individual: 'One live slot, in any section. The simplest way to
  reach local buyers with a post people can trust.' reads 'Each slot keeps one
  post live, in any section, and you can hold 1 to 4 slots at a time. The
  simplest way to reach local buyers, with your ID reviewed before you post.';
  '1 live slot in ...' reads '1 to 4 live slots at a time in ..., one post
  each'; 'Individual plans (one live slot)' reads 'Individual slots (price per
  slot)'.
- Hidden, sponsor offer on hold: on Advertise the Business Sponsor package, its
  'Founding pilots' box, the sample partner report, the 'Supported by' line, the
  two sponsor questions and 'Talk to us about sponsoring' (with one package
  left, the 'Which one is for you?' chooser goes too); on the home page's
  sponsor band and the Business Sponsors page, 'Become a Business Sponsor' and
  the 'Want to support local businesses?' band; with no sponsor listed, the
  Business Sponsors page's box reads only 'No sponsors yet' (was 'Our first
  Business Sponsors are joining' and 'Founding programmes open ...'); on an
  organisation's dashboard after its pilot, 'See programme prices'; in the
  hidden pricing package block, the sponsor card and fee table. Current sponsors
  are still listed.
- Hidden, paid add-ons: 'Get more eyes on a post' (Urgent, Boost, Featured) on
  Advertise, 'Urgent label add-on' on the plan cards (Pricing, Billing),
  'Optional Urgent label add-on' in the posting flow and the post button's plan
  list, and 'Boost and Featured don't buy a better place here' on the showroom
  help page.
- Edits (the database counts approved edits over a post's whole life; its slot
  sets the allowance): 'Up to 2 approved edits per live post' (Advertise) reads
  'Each live post: up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day
  slot'; 'Each live post can have up to 2 approved edits.' (Pricing and the edit
  screens) reads 'Each live post can have up to 2, 6 or 12 approved edits for a
  30-, 90- or 180-day slot (a free post or an event: 2).'; the edit screens'
  'This listing has used its 2 approved edits.' reads 'This listing has used all
  its approved edits: up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day
  slot (a free post: 2).' (business profiles alike; events keep 'This event has
  used its 2 approved edits.').
- Free first post: the billing answer states the Terms' rules (7 days from
  approval, once per ID-reviewed person, a rejected post does not use it, one
  post at a time waits for it, an unused paid slot is used first); 'Campaign
  availability can change', 'frees the space for another member' and 'location
  verification' are gone; 'One per verified member.' and 'One free trial per
  verified person.' read 'One per ID-reviewed person.' and 'One free post per
  ID-reviewed person.'.
- VAT: 'VAT status: VAT number not currently published' (billing answers, Trust
  & Safety, the Terms page's fallback text) reads 'VAT status: not registered
  for VAT', as the Terms say (`src/lib/trust-public-config.ts`).
- Hidden pages, multi-listing: the Advertise package and the pricing package
  block's Multi-listing card state the P4a rules instead of '10 to 100 live
  slots', '2 named administrators' and 'written quote'; 'You + 1 person (you + 4
  from 50 slots)' is hidden, and the Multi-listing page links to Advertise's
  Multi-listing section only while that section is shown.

Text outside the checked scope with the same purpose: the switches
(`src/lib/hidden-features.ts`), the VAT default
(`src/lib/trust-public-config.ts`), the post button's plan list
(`getPlanFeatureItems` in `src/lib/constants/pricing.ts`) and the edit rule and
edit-limit message (`CURRENT_EDIT_RULE`, `editLimitReachedMessage` in
`src/lib/posting/package-rules.ts`, shown on Pricing and the three edit pages,
whose files are unchanged).

| File                                                 | Kind | Reason                                                                                            | What changes on screen       | Proposed | Owner decision               | Date       | Version      |
| ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- | ---------------------------- | -------- | ---------------------------- | ---------- | ------------ |
| `src/components/posting/package-rules-note.test.tsx` | test | Group 40: expects the edit rule 'up to 2, 6 or 12 approved edits for a 30-, 90- or 180-day slot'. | Nothing (not part of a page) | keep     | approved by owner 2026-11-17 | 2026-11-17 | 81f2cab508ed |

### 41. Account events in the bell

No file in the checked scope changes, so this group has no file rows (Files 0).
The new notices come from database update
`20261117140533_member_notices_in_app.sql`; the bell itself
(`src/components/notification-bell.tsx`, its row in group 2) is unchanged by
this group. The notices and their wording are owner question 31. Decision:
awaiting owner.

### 43. A working Delete account button (roadmap M1.6c)

'Delete account' on the profile's Account tab (hidden until it works in group
27, SEC-02) works on the live backend. It stays behind its switch
`SHOW_ACCOUNT_DELETION` (`src/lib/hidden-features.ts`, off in production) until
the owner approves this group: while it is off, the tab keeps the line 'To close
your account, send us a data request.' and the route answers 404. Once it is on,
the button is shown again in the chosen version's place and style and that line
is gone. The route behind it (`/api/account/delete`, outside the
checked scope) calls the member command `api.close_my_account` through the
foundation owner route (same origin, CSRF, the `account:delete` limit, the
verified session); it no longer touches the retired backend. The database closes
the account at once (posts leave the site, closing counts as a request to cancel
the slots under the Terms, sign-in is blocked and every session ends) and plans
the erasure for 30 days later, which waits while a payment, refund, invoice,
report or hold is open; the deletion request it records is due 7 days after that
(owner decision 16 Nov). Reopening during the 30 days is staff-only and not
built.

The line under 'Delete account' no longer says the data goes 'for good': it
names the records kept by law and links the Privacy Policy, as its retention
section says. The confirmation dialog keeps its title, 'Type DELETE', 'Cancel'
and 'Continue', and changes in two ways (owner question 32): it lists what
happens before it can be confirmed, and the 'Current password' field is replaced
by a password or Google sign-in from the last 15 minutes, checked by the route
before the database ('Sign in again' when it is not). The database checks the
sign-in again; when it refuses, the dialog asks for a fresh sign-in the same
way, so the flow works whether or not the database counts only a password or
Google sign-in. A lost or unclear answer says the outcome is
unknown and how to check it, never that the account was not closed; after a
closure the page shows it closed and a retry with the ended session says so. On
phones the longer dialog sits at the bottom of the screen with room above it,
because the site header stays above dialogs and would otherwise cover its title.
The refusals it explains: a sign-in older than 15 minutes, a staff account
(staff roles must end first), an ended session, an account that no longer
exists, and a closure that could not block sign-in or end a session (nothing
changed); anything else gets the route's general message with a reference. Open
payments, bank transfers, refunds, invoices, reports and holds do not stop the
closure; they make the erasure wait, as the dialog says.

The two profile files already have rows in the table above (Differences); each
says 'Group 43', so this group has no file rows of its own. Tests outside the
checked scope: `src/lib/foundation/account-closure.test.ts`,
`src/app/api/account/delete/route.test.ts` and the 'delete my account' step of
`e2e/foundation/account-recovery.spec.ts`, which runs the whole flow in the
launch configuration and otherwise checks that it stays hidden.
Proposed: keep. Owner question 32: approved by the owner on 2026-11-19. The
switch stays off in production until the staff half is built, and goes on
before launch.

### 44. Phone dashboard pages widened by the strip

On every member dashboard page, Chrome on phones made the page wider than the
screen (841 instead of 412 points on a Pixel 7) to fit the hidden width of the
scrolling 'Leads, Profile and settings, Notifications' strip. Fixed elements
(dialogs, toasts) were then placed against that wider page, so they sat partly
off-screen and a dialog's buttons could be out of reach. Found by the phone
browser check of the Delete account work (#253). The strip now keeps its hidden
width to itself (`contain: paint`); it looks and scrolls the same. The chosen
version (`0b562f42`) has the same strip, so this is a fix to it. Proposed: keep.
Decision: approved by owner 2026-11-19.

| File                                                | Kind              | Reason                                                                                                                                                                               | What changes on screen                                                                                  | Proposed | Owner decision | Date       | Version      |
| --------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- | -------------- | ---------- | ------------ |
| `src/components/dashboard/dashboard-mobile-nav.tsx` | wording-behaviour | Group 44: Chrome on phones widened every dashboard page to fit the strip's hidden width, putting dialogs and toasts partly off-screen; the strip now contains it (`contain: paint`). Group 66 (owner: no black, light tourism colour): the selected item is light teal instead of black. | Nothing visible on the strip; on phones, dialogs and toasts on dashboard pages sit on the screen again. Group 66: dashboard phone strip: the selected item (for example 'My posts') is light teal with dark teal words and a thin teal edge, instead of a black pill with white words. | keep     | approved by owner 2026-11-19; group 66 part approved by owner 2026-11-20 | 2026-11-20 | 1eb451f0d6cb |

### 46. Opening the ID check page only reads

Live-test fix (17 November). Opening `/verification` sent a background request
that started a verification case on the server
(`/api/verification/session/start`) before the member had done anything. The
page now only reads the saved status (`/api/verification/status`, which it
already read) to choose the step to show. A case is still opened by the member's
own action: uploading the ID document opens it on the server, as before.

- Nothing on screen changes: the same loading panel, then the same step,
  messages and completion card, worked out from the same saved facts.
- Three branches that only that background request could reach are gone: an
  'email not confirmed' notice (the live backend signs in confirmed accounts
  only; the notice still shows when an upload or location save is refused for
  that reason), a 'Session expired' toast (never sent by the live backend), and
  the 'Verification temporarily unavailable' notice, which now shows when the
  status read itself finds no verification service.
- In the same PR, a bare page load of the error page (`/error` with no reason,
  or an unknown one) answers a real HTTP 404 instead of 200, with the same
  'Something went wrong' page as before (the proxy decides before the page
  streams; no page file changes). The site's own redirects to
  `/error?reason=forbidden` and `/error?reason=unavailable` still answer 200.

The changed files, `src/app/verification/page.tsx` and its test, already have
rows in groups 2 and 5, so this group has no file rows (Files 0); those rows say
'Page view: group 46' and their earlier decisions stand for their earlier
changes. Proposed: keep. Decision: awaiting owner.

### 45. Bank transfers expire after 14 days

Owner decision 2026-11-16: a recorded bank transfer (P2b) that is still waiting
for a second staff member 14 days after it was recorded expires (database update
`20261118044440_bank_transfer_expiry.sql`). Nothing is paid or started; the
invoice it named is unpaid again and can be paid, as after a decline. What
changes on screen (new wording, for the owner's approval):

- Staff, payments page, 'Record a bank transfer' card: below 'Waiting for a
  second staff member', a list 'Not confirmed within 14 days' (with ' · N,
  oldest shown' when there are more than the 200 it shows) and under it 'Listed
  until the same money is recorded again and confirmed, or it is resolved
  below.' It lists every expired transfer still to be followed up, oldest first,
  however long ago it expired; a paid or voided invoice or a declined new record
  does not take it off. Each row has the same first line as a waiting transfer,
  the existing grey 'Expired' badge (the payments list's badge style), the bank
  reference, date cleared, invoice number when there is one, customer, who
  recorded it and when it expired, and 'Nothing was paid or started. If the
  money is in the bank account, record it again.' Staff who may confirm
  transfers see two buttons on each row, 'Money returned' and 'Never arrived'
  (the same outline buttons as 'Decline'); each asks 'Reason (audited, at least
  5 characters):' and then shows 'Expired bank transfer resolved.' For the staff
  member who recorded it both are greyed out, with 'You recorded it: another
  staff member must resolve it.' (as 'Confirm transfer'). The card also shows
  when only expired transfers are listed. A transfer that has waited 14 days
  leaves the waiting list at once, even before the sweep (every minute) marks
  it.
- Staff, after confirming or declining a transfer that has just expired: the
  refusal reads 'This bank transfer is no longer waiting for confirmation: it
  was confirmed or declined, or nobody confirmed it within 14 days and it
  expired. Reload the page.'; recording money that cleared more than 90 days
  ago: 'Enter the date the money cleared: today or in the last 90 days, or an
  earlier date only to record again the money of an expired transfer (same
  reference, amount and date).' (both outside the checked scope,
  `src/lib/foundation/staff-payments.ts` and `customer-invoices.ts`).
- Member, invoice page (`/billing/invoices/<number>`), 'Pay': while the invoice
  is unpaid and its latest bank transfer expired, 'Your bank transfer to this
  invoice was not confirmed within 14 days, so it expired and this invoice is
  unpaid again. If you already paid, email billing@verifymzansi.com with your
  proof of payment and the invoice number before you pay again.' above the usual
  cooling-off box and Pay now (or the bank-transfer-only note). The 'being
  checked' note it replaced is gone, as after a decline.

No email is sent. Every changed file already has a row (the payments page and
the bank transfer card in P2b, the invoice page and the payment panel in group
31), so this group has no file rows; those rows say 'Expiry: group 45'
and their earlier decisions stand for their earlier changes. Tests:
`bank-transfer-form.test.tsx` and `invoice-pay-panel.test.tsx`. Proposed: keep.
Decision: awaiting owner.

### 47. Less personal data on staff and organisation screens

Data minimisation after an access review (database update
`20261118072601_staff_data_minimisation.sql`, owner decisions of 18 November
2026). The look of every screen is kept. What each person now sees:

- **Staff, review queues** (ID checks, business verification, 'seen in person'
  and CIPC cases): a member is named by their public short name ('Thandeka
  D.', as on the public seller card) instead of their full legal name. The
  full legal name still shows where it did: inside a case the staff member
  holds (claim, assignment or decision) after verifying their authenticator in
  the last 15 minutes, recorded in the case's access log. No page file
  changes for this; the names come from the server.
- **Staff, data requests** (`/admin/dsar`): nothing changes on the page. One
  staff member still records, checks, approves, exports and completes a
  request.
- **Staff, support inbox** (`/admin/support`): requests received in the last
  12 months are listed, and older ones only while still New or In progress.
  A request resolved more than 12 months ago cannot be reopened: changing its
  status shows 'This request was resolved more than 12 months ago and can no
  longer be changed.' Nothing else changes on the page.
- **Staff, payments and invoices**: unchanged.
- **Members with a data request**: the bell shows 'Your data request was
  approved' when staff approve it and 'Your data export was made' when staff
  first export their data (both link to /dsar); the requester also gets two
  new emails, 'Data request approved' ('Your VerifyMzansi data request has
  been approved') and 'Your data request reply was prepared'. Each comes once.
  A request staff recorded by hand gets the approval notice in the bell when
  the identity check links it to the account.
- **Organisation administrators** (`/dashboard/organisation/<slug>`):
  co-administrators are listed by their short name (the viewer's own name as
  before). On the Applications tab, a pending application (Pending or More
  information) shows 'Business contact: Show contact'; tapping it shows the
  business's public phone, email and website for that application only, and
  the reveal is recorded in the organisation's audit log. Approved, declined
  and withdrawn applications show 'Business contact: —'. Until the database
  update is applied, a pending application shows its contact inline as today.
  The staff organisation page (`/admin/organisations/<id>`) is unchanged.

The dashboard page keeps its row in group 27, which says 'Data minimisation:
group 47'; its earlier decision stands for its earlier change. The one new row
below is the Applications list, which matched `0b562f42` until now. Proposed:
keep. Decision: awaiting owner.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/organisations/organisation-management.tsx` | wording-behaviour | Group 47: an organisation's administrators see an applicant's business contact only while the application is pending, and only on request (owner decision, 18 November 2026). | Organisation dashboard, Applications: a pending row shows 'Business contact: Show contact' (a text button) until tapped, then the phone, email and website; other rows show '—'. The staff organisation page still shows contacts inline. | keep | awaiting owner | 2026-11-18 | 2eff1c8a9149 |

### 48. Refund follow-ups, read before the database update

Owner decisions 2026-11-18 (refund follow-ups, plan B): a new refund reason
'Cancelled before the renewal started'; a slot whose renewal is waiting is
refunded renewal first; refunds through Ozow only up to 13 days after the
payment; after that staff pay back by bank transfer and record the bank
reference. This group is the website-first part (B0), deployed before the
database update so the live site never meets a value it cannot read. Nothing
changes on screen today:

- Staff, payments page, refund forms ('Record refund', 'Refund this slot',
  'Refund through Ozow', 'Refund made in the Ozow dashboard'): the 'Reason'
  list still offers the same five reasons. 'Cancelled before the renewal
  started' is not offered yet (the current database refuses it); a later
  change offers it on a renewal slot whose days have not started.
- Staff, a refund recorded with that reason (possible only after the database
  update) reads 'Cancelled before the renewal started' where the reason is
  shown (a refund waiting for approval, a payment's Ozow refunds).
- Staff, a refund through Ozow the database stops because Ozow's window passed
  (only after the database update): its line ends ' · too late for a refund
  through Ozow: pay it back by bank transfer and record the bank reference'.
- Staff, three refusals (only after the database update; outside the checked
  scope, `src/lib/foundation/staff-payments.ts`): 'This slot has a renewal
  waiting. Refund the renewal first, then this period.', ''Cancelled before
  the renewal started' is only for a renewal whose days have not started.
  Choose another reason.' and 'Ozow refunds are possible only up to 13 days
  after the payment. Pay it back by bank transfer and record the bank
  reference instead.'

Every changed file already has a row (`payment-actions.tsx` in M3.4,
`ozow-refund-actions.tsx` in group 28 and the test
`payments-panel.test.tsx`), so this group has no file rows; those rows say
'Refund follow-ups: group 48' and their earlier decisions stand for their
earlier changes. Proposed: keep. Decision: awaiting owner.

### 51. Refund follow-ups offered to staff

Owner decisions 2026-11-18 (refund follow-ups, plan B, decisions B1 to B4).
This is the part that comes with the refund follow-ups database update
(`20261118182332_refund_follow_ups.sql`); group 48 taught the website to read
the new values first. (Group 49 is used by two other open pull requests, so
this group is 51.) Staff only, payments page:

- 'Record refund', 'Refund this slot', 'Refund through Ozow' and 'Refund this
  slot through Ozow': the 'Reason' list also offers 'Cancelled before the
  renewal started', only on a renewal payment (one whose description starts
  'Renewal:'). The payments list does not say whether the renewal's days have
  started, so the database decides that and refuses otherwise ('...is only for
  a renewal whose days have not started. Choose another reason.', group 48).
- A payment paid through Ozow: its line ends ' · Ozow refund possible until
  <date>' (13 days after the payment, South African date) or, once that date
  has passed by this device's clock, ' · Ozow's 13 days for a refund ended
  <date>: pay it back by bank transfer'. The clock only words the line: no
  refund way is hidden by it; the database decides, and its refusal says what
  to do instead (group 48).
- Next to the Ozow refund, 'Paid back by bank transfer' (per slot 'Slot paid
  back by bank transfer') opens the refund form, which reads 'Bank reference
  of the refund transfer' ('From the bank's payment confirmation') and, before
  the money is paid, 'Before you pay: Ozow refunds this payment until <date>;
  pay it back by bank transfer only after that (before then, refund it through
  Ozow). If a renewal of this slot is waiting, refund the renewal first: this
  refund is refused while one waits.' A refund of a bank-transfer payment
  shows the renewal sentence too. 'Recorded in the Ozow dashboard' and 'Record
  chargeback' (with Ozow's reference) stay.
- 'Approve and send to Ozow': when nothing could be sent (the payment changed,
  or the 13 days passed), the message reads 'Nothing was sent to Ozow: the
  payment changed, or the 13 days for a refund through Ozow passed. It is
  listed under 'Refunds that need staff' with what to do.' instead of 'Ozow
  did not accept the refund...'. 'Ozow did not accept' stays for a refund Ozow
  refused.

Every changed file already has a row (`payment-actions.tsx` in M3.4,
`partners-panel.tsx`, `ozow-refund-actions.tsx` in group 28 and the two
tests), so this group has no file rows; those rows say 'group 51' and their
earlier decisions stand for their earlier changes. Proposed: keep. Decision:
awaiting owner.
### 49. Pricing by offer

Owner request of 18 November 2026: on /pricing, organise the offers as
Individual / Multi-listing / Business sponsors instead of by section, and make
clear that a slot is what is sold. The owner chose design variant B, picture 01
(screenshots/design-pricing-tabs-2026-11-18/, not committed): a tab shows only
for an offer that is on sale, so while only Individual slots are sold there is
no tab row. Two owner adjustments: the 30-day card is highlighted, and the strip
keeps 'Up to 4 posts per 30 days' (posting-v5 fair use, the catalogue's 4
activations per 30 days).

- The section picker ('Where will you post?' Mzansi Market / Mzansi Business /
  Tourism & Events) is gone. It never changed the price or the plan: every
  section's link named the same Individual slot plan. The heading reads
  'Posting slots', 'A slot keeps one of your posts live.'
- One 'Every slot includes' strip: '1 live post at a time', '10 photos and 1
  video', 'Up to 4 posts per 30 days', 'Market, Business or Tourism' with the
  three section icons. The cards no longer repeat the first two lines.
- Three term cards: '30 days' R69 'Paid once', '90 days' R207 and '180 days'
  R414 'R69 per 30 days'; buttons 'Choose 30 days' (filled) and so on, each to
  the section-free Individual slot checkout. Under them 'Hold up to 4 slots at a
  time.' and 'Prices in ZAR. How billing works'.
- Free events move from a fourth card to a strip below: 'Events are free', 'No
  slot needed. Moderated, live until the event ends.', 'Post an event'. The
  words 'fair use' are dropped.
- The Tourism-only 'Start free: 7 days' card is gone; the hero's 'Your first post
  is free' card says the same for every section.
- While packages are on sale (PACKAGES_ON_SALE) a second tab, 'Multi-listing',
  shows: 5 to 250 slots, 10 photos and 1 video per post, up to 4 posts going
  live per slot per 30 days, ID review first and one package per account, R100
  per slot per 30 days, and 'Choose your package' to /pricing/multi-listing;
  'Need 5 or more?' under the Individual cards opens it. Off today, so not
  visible.
- The hidden Multi-listing and sponsor block below the plans
  (enterprise-pricing.tsx, shown only while packages are on sale) is no longer
  rendered on /pricing, so packages are never offered twice.
- No Business sponsors tab: the sponsor offer is on hold (SHOW_SPONSOR_OFFER)
  and has no way to buy, so none is built yet.
- /billing still shows the plan cards with the section picker (retail-pricing.tsx,
  unchanged).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/billing/pricing-offers.tsx` | visual | Group 49: the pricing page's offers, one tab per offer on sale (variant B). Group 66: The three terms are equal choices; 'Post for free' is the page's main button. | Pricing page plans section, as described in group 49. Group 66: Pricing: the 30, 90 and 180 days cards look the same, with no highlighted card (the 30-day card had a green edge and ring and a filled button); 'Choose 30/90/180 days' all outlined. With packages on sale, 'Choose your package' outlined. 'Post an event' outlined as before. | keep | approved by owner 2026-11-18 (variant B, picture 01); group 66 part approved by owner 2026-11-20 | 2026-11-20 | d1c3d1738fc9 |
| `src/components/billing/pricing-offers.test.tsx` | test | Group 49: checks no tab row while only Individual is on sale, the section-free checkout links, the highlighted 30-day card, free events, 'Opens soon' off sale, and the Multi-listing tab. Group 66: Checks the three terms are equal and outlined. | Nothing (not part of a page) Group 66: Nothing (not part of a page) | keep | approved by owner 2026-11-18 (variant B, picture 01); group 66 part approved by owner 2026-11-20 | 2026-11-20 | c20b6b0315e1 |

### 52. Old multi-listing wording and a council mention

Two clean-ups of words hidden behind switches that are off, so nothing on
screen changes today:

- Multi-listing (roadmap P4a, owner decisions of 14 November 2026, decision
  14): the 'Need more posts live at once?' / 'Listing lots of stock?' box in
  the posting flow and on billing (`multi-listing-nudge.tsx`, hidden while
  packages are not on sale) read 'Multi-listing keeps 10 to 100 posts live at
  the same time for 90 or 180 days, at a lower price per post.' It now reads
  'A Multi-listing package keeps 5 to 250 posts live at the same time for 30,
  90 or 180 days, at R100 per slot per 30 days. For dealers, agencies, shops
  and landlords.' It says nothing about teams, adding slots later, renewing a
  package or package invoices, which are not built yet (P4b to P4e). The old
  multi-listing plan tables (10/25/50/100 slots for 90 or 180 days, '2 named
  administrators', 'quote above 100') are removed from the code, with the
  unused plan list `enterprise-pricing.tsx` accepted. Outside the checked scope
  (`src/lib/foundation/checkout-summary.ts`): the checkout no longer names
  administrators for a plan with several slots (no such plan is on sale).
  The hidden Multi-listing price list on Advertise ends 'any number from 5 to
  250' (was 'any number from 5'): a package holds 5 to 250 slots.
- Owner instruction 2026-11-18: VerifyMzansi has no agreement with any
  council. The hidden 'Founding pilots' box on Advertise (it named a council
  programme and a closing date) is removed, and the hidden line in the empty
  Business Sponsors box reads 'Their businesses appear here as they go live.'
  instead of naming a council. Example names in code comments and tests are
  made up.

(Group 49 is the pricing page by offer and 51 the refund follow-ups, so this
group is 52.) Every changed file already has a row (`advertise/page.tsx`,
`advertise/page.test.tsx`, `sponsors/page.tsx`,
`multi-listing-nudge.tsx`, `enterprise-pricing.tsx` and
`enterprise-pricing.test.tsx`); those rows say 'Group 52' and their earlier
decisions stand for their earlier changes. Proposed: keep. Decision: awaiting
owner.

### 53. Package invoices and 'Ask for an invoice' (Pricing v2 P4e)

Roadmap P4e, the owner's decisions 5, 6 and 12 of 14 November 2026 (multi-listing
gap review) and the approved draft p4-02. Nothing changes while Multi-listing
packages are not on sale (the owner's switch in the database).

- 'Choose your package' above Ozow's maximum (or above 100 slots): 'Ask for an
  invoice' is a button that sends the request to staff (it opened an email to
  billing). Before it, the invoice's own tick, in the words the database records
  for every invoice (invoice-cooling-off-v1): 'My slots start as soon as this
  invoice is paid; the 7-day cooling-off does not apply because the service
  starts immediately.' Posting-v5 asks for this confirmation when the invoice is
  requested; draft p4-02 had no tick, so this is a difference from the draft
  for the owner to approve. Starts reads 'When your invoice is paid' (p4-02).
- The draft's note 'Over R10 000 is paid by invoice. We email it to you; pay it
  from Invoices with Pay now. [wording to confirm]' is not used: the R10 000
  line is gone and a package above Ozow's maximum is paid by bank transfer. The
  note keeps today's words ('Ozow takes payments of up to R1 300, so this
  package is paid by invoice, at the same price.'). New words to confirm: 'Invoice
  requested. We will let you know when it is ready; then pay it from Invoices.'
- Staff only: a 'Package invoice requests' card on Payments & Refunds, shown
  only while a request is open: each request (member, slots x days, total, when
  asked) with 'Issue invoice' (days to pay and an audited reason), 'Prepare
  invoice' above R50 000 (a second admin then sees 'Approve and issue'), and
  'Decline' with a reason; and why no invoice can be issued when the member's ID
  review is not accepted or they already have a package.
- Refusals in plain words (`src/lib/foundation/package-invoices.ts`): 'Multi-listing
  packages are not on sale yet.', 'This account already has a Multi-listing
  package. Its slots are on My slots.', 'Your package invoice is not paid yet. Pay
  it from Invoices, or email billing@verifymzansi.com to cancel it first.', 'We are
  preparing your invoice. Email billing@verifymzansi.com to change it.', and the
  staff messages; 'You have asked for many invoices today. Try again tomorrow, or
  email billing@verifymzansi.com.' (more than 10 requests in 24 hours). The online
  package checkout refuses while a package invoice is unpaid: 'Your package
  invoice is not paid yet. Pay it from Invoices, or email billing@verifymzansi.com
  to cancel it first.' (`billing-runtime.ts`). Two existing messages gain 'and a second package cannot start'
  (`customer-invoices.ts`).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/admin/commercial/package-invoice-requests.tsx` | visual | Group 53: staff issue, prepare, approve or decline members' package invoice requests (owner's decision 6). Group 62: added-slots invoice requests in the same queue. | Staff only, Payments & Refunds: the 'Package invoice requests' card described in group 53. Group 62: an added-slots request reads 'Add <n> slots · priced for <d> days' with a line 'Package ends <date, time> · <n> whole days left now' (and, when fewer days are left than priced, '· issued now, the invoice is for <n> days at their lower price'), its issue form shows 'Due <date> (3 days after it is issued, or the package's last day if sooner)' instead of 'Days to pay', and it warns when fewer than 10 days are left. | keep | awaiting owner; group 62 part awaiting owner | 2026-11-20 | c6bc71910579 |
| `src/components/admin/commercial/package-invoice-requests.test.tsx` | test | Group 53: checks the card is absent with no open request, issuing, preparing and approving by another admin, and read-only staff. Group 62: checks an added-slots request shows the priced days, the package end and the days left now, and why it cannot be issued. | Nothing (not part of a page) | keep | awaiting owner; group 62 part awaiting owner | 2026-11-20 | 8f07cd4130a9 |

### 54. Privacy tightening 2: short names, search depth, partner rate

Database update 20261119065758_privacy_tightening_2 (website first: this
release is deployed before the update is applied). Owner decisions A1 to A3
(18 November 2026), at the recommended values:

- Search and browsing (A1): page links stop at page 100. On the last page,
  when there are more results, 'Showing the first N results. Narrow your search
  to see more.' (N is 100 pages: 2 400 on Mzansi Market, Mzansi Business and
  Tourism & Events, 1 200 on Search). An address with a deeper page shows page
  100 (no error page). Nothing changes for anyone who narrows the search.
- Partners (A2, staff only): 'Custom rate % (optional, up to 20%)'; rates above
  20% are refused.
- Short names (A3, staff only): Enforcement names a restricted member
  'Thandeka D.' with the account reference beside it; Partners and the staff
  organisation page name members 'Thandeka D.' (from the database).
- Staff organisation page: an applicant's business contact is shown only while
  the application is pending, behind 'Show contact' (logged in the
  organisation's history), as on the organisation dashboard (group 47).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/(marketplace)/mzansi-business/grid.tsx` | wording-behaviour | Group 54: page links stop at page 100. | Mzansi Business grid: Group 54: page links stop at page 100; on the last page, when there are more results, 'Showing the first N results. Narrow your search to see more.' (N = 100 pages of results); a deeper page address shows page 100. 24 a page, so 'Showing the first 2 400 results.' | keep | awaiting owner | 2026-11-19 | a9ca5ae89088 |
| `src/components/listings/marketplace-pagination-controls.tsx` | wording-behaviour | Group 54: the line on the last page when results go deeper than the page links. | Mzansi Market, Mzansi Business and Tourism & Events: under the page links on the last page, 'Showing the first N results. Narrow your search to see more.' when there are more results. | keep | awaiting owner | 2026-11-19 | d73cfa7a34c3 |
| `src/components/listings/marketplace-pagination-controls.test.tsx` | test | Group 54: checks the line shows on the last page only, and not when every result has a page. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | 0aab704618f2 |

### 55. Pricing: 'Editing your post' heading

On Pricing, the box under the slot prices was headed 'How your package works'.
Its text is the approved-edits rule for every live post, and 'package' now
means the Multi-listing package, so Individual buyers could read it as not
applying to them. The heading now reads 'Editing your post'; the text, layout
and the heading's link to its section are unchanged. No file rows: the group 55
part of the existing `src/app/pricing/page.tsx` row. Decision: approved by owner
2026-11-19.

### 56. Loading screen named for screen readers

Accessibility fix with no visual change. The grey placeholder shown while any
page loads was labelled 'Loading' on a plain box, which most screen readers
ignore, while each of its six grey blocks announced 'Loading' on its own. As
on the sign-in loading screen (`src/app/(auth)/loading.tsx`), one hidden
'Loading' status now sits before the main area and the grey blocks are hidden
from screen readers. The page keeps its single main area and looks the same.
Decision: approved by owner 2026-11-19.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/loading.tsx` | wording-behaviour | Group 56: the wrapper's 'Loading' label (ignored by most screen readers on a box with no role) is replaced by one visually hidden `role="status"` 'Loading' text before `<main>`, and the six skeleton blocks get `aria-hidden`, as in `src/app/(auth)/loading.tsx`. | Nothing visible; screen readers hear one 'Loading' status while a page loads | keep | approved by owner 2026-11-19 | 2026-11-19 | 84f5c08935da |
| `src/app/loading.test.tsx` | test | Group 56: checks the placeholder has exactly one status, reading 'Loading', its six skeleton blocks are hidden from screen readers, and it keeps exactly one main area. | Nothing (not part of a page) | keep | approved by owner 2026-11-19 | 2026-11-19 | 38c19ac5c6f4 |

### 57. Removed for launch: old staff tools, trial tools, data-use choices and the province chip

Owner decision 19 November 2026 (build-mode review rows A16, A18, A19 and A20):
features that will not exist at launch are deleted rather than kept hidden.
Nothing new is added and nothing is restyled. Their switches are gone from
`src/lib/hidden-features.ts`: `SHOW_STAFF_COMMERCIAL_SETTINGS`,
`SHOW_STAFF_TRIALS`, `SHOW_STAFF_PROGRAMMES`, `SHOW_STAFF_INTELLIGENCE`,
`SHOW_TRIAL_PLAN_CHANGES`, `SHOW_TRIAL_EXTENSION_OFFERS`,
`SHOW_DATA_USE_CHOICES` and `SHOW_SHOWROOM_PROVINCE_CHIP`.

- Staff (A19): the 'Commercial settings', 'Free posts & trials', 'Programmes &
  contracts' and six 'Intelligence' pages are deleted. Their addresses answer
  'Page not found' (404) instead of leading to the staff home. Their menu
  entries and staff capabilities are gone. The Partners and Payments panels
  keep `/api/admin/commercial`, which no longer accepts the removed pages'
  settings, price, programme, contract, trial and extension changes.
- Trial tools (A18): the dashboard trial card keeps the member's free week, its
  plan and posts links; 'Renew using my paid plan' and 'Switch pending post to 7
  days' are deleted with `/api/trials`. Trial extension offers are deleted:
  the organisation dashboard card, the staff 'Offer a pilot extension' link and
  `/api/trial-extensions/<id>`. Both routes answer 404, as before.
- Data use (A20): the Notifications page offers only 'Marketing email' and
  'Marketing SMS'. The preferences route still turns 'Analytics' and
  'Third-party sharing' off (never on), so existing records stay consistent;
  the database is unchanged.
- Province first (A16): the hidden 'Showing <province> first' chip is deleted,
  and with it the per-visit province estimate from the connection. The help
  page drops 'Local first, never local only', its 'How we know your province'
  section and 'local posts first' in its description and heading line. The privacy notice drops its
  'Showroom location' paragraph, which described that estimate and the cookie
  that remembered a chosen province; the viewer no longer writes that cookie.
  The province filter in the filter bar and the viewer stays.

Outside the checked scope, with the same purpose: the routes
`/api/admin/trials`, `/api/trials` and `/api/trial-extensions/<id>`, the staff
menu (`src/lib/admin/nav.ts`) and capabilities (`src/lib/auth/roles.ts`), the
helpers only they used, and the launch-configuration browser test, which now
checks that each removed page and route answers 404.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/commercial/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Commercial settings' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/trials/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Free posts & trials' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/programmes/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Programmes & contracts' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/users/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Users & growth' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/verification/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Verification metrics' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/revenue/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Revenue & costs' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/marketplace/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Marketplace health' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/trends/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Trends' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/intelligence/operations/page.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A19). The page read tables the live backend does not have; it was hidden (group 27) and is now deleted with its menu entry and staff capability. | Staff only: the 'Operations summary' page is gone; its address answers 'Page not found' (404) instead of leading to the staff home. It was already off the menu. | keep | awaiting owner | 2026-11-19 | deleted |
| `src/app/admin/trials/page.test.tsx` | test | Removed with the page it tested. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/commercial/commercial-settings-panel.tsx` | wording-behaviour | Removed: used only by the removed 'Commercial settings' page. | Nothing (it showed only on that page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/commercial/programmes-panel.tsx` | wording-behaviour | Removed: used only by the removed 'Programmes & contracts' page. | Nothing (it showed only on that page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/trial-management.tsx` | wording-behaviour | Removed: used only by the removed 'Free posts & trials' page. | Nothing (it showed only on that page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/trial-extensions-panel.tsx` | wording-behaviour | Removed: used only by the removed 'Free posts & trials' page (trial extension offers, row A18). | Nothing (it showed only on that page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/cost-overview-panel.tsx` | wording-behaviour | Removed: used only by the removed 'Revenue & costs' page. | Nothing (it showed only on that page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/trial-management.test.tsx` | test | Removed with the removed trial tools. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/cost-overview-panel.test.tsx` | test | Removed with the removed cost panel. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/trials/extension-offer-card.test.tsx` | test | Removed with the removed extension offer card. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/trials/extension-offer-card.tsx` | wording-behaviour | Removed (row A18): the trial extension offer card on an organisation's dashboard and the route behind it (/api/trial-extensions/<id>). The live backend has no extension offers, so it never showed (hidden in group 27). | Nothing (it never showed) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/showrooms/showroom-province-chip.tsx` | wording-behaviour | Removed (owner decision 19 November 2026, row A16): the 'Showing <province> first · Change' chip under the showrooms. The showroom does not order posts by province; it was hidden (group 6). The province filter in the filter bar and the viewer stays. | Nothing (it was hidden) | keep | awaiting owner | 2026-11-19 | deleted |
| `src/components/admin/intelligence-panels.tsx` | helper | The 'Decision' panel, used only by the removed Intelligence pages, is removed; the chart panels the staff home's traffic card uses stay. | Nothing (same look and steps) | keep | awaiting owner | 2026-11-19 | 2ef9ef274605 |
| `src/components/admin/admin-sidebar.tsx` | helper | The five menu icons only the removed staff pages used are dropped from the icon list. Group 65: adds the person-plus icon for the new Member invitations menu entry. Group 93: adds the gift icon for the new Free credits menu entry. | Nothing from group 57 (same look and steps). Group 65, admins only: a person-plus icon beside Member invitations in the Platform section. Group 93, admins only: a gift icon beside Free credits in the Commercial section. | keep | awaiting owner (group 65 part approved by owner 2026-11-20); group 93 part awaiting owner | 2026-11-22 | 49363e39e083 |
| `src/components/immersive/immersive-top-bar.tsx` | wording-behaviour | The province picked in the viewer is no longer also saved in a cookie: only the removed 'province first' showroom read it (row A16). | Nothing (the province filter works as before) | keep | awaiting owner | 2026-11-19 | 910d0f8a714b |

### 58. 'Detect province and city' shown at launch

Owner decision 19 November 2026 (row A17): the 'Detect province and city'
button in the verification location step, hidden in group 22 because its route
always failed, is built and shown at launch. Its route
(`/api/verification/location/detect`, outside the checked scope) now runs on
the live backend: it reads the approximate network location Cloudflare gives
each request, offers a province and city only when both are on the step's lists,
and saves nothing. The member still confirms the pair with 'Save location &
finish'. Until launch its switch `SHOW_LOCATION_DETECTION`
(`src/lib/hidden-features.ts`) stays off in production, like every hidden
feature; its launch value is on (`src/lib/launch-config.ts`). No file rows: the
verification page already holds the button and its line unchanged (the
group 58 part of its row in group 2). Detection uses only the request's own
Cloudflare data, so a local copy served with `next start` always answers that
it detected nothing.

When shown, the location step has the 'Detect province and city' button and the
line 'Detection is approximate. You can also select your location manually.',
as in the chosen version. Pressing it either fills in the province and city with
'Location suggested. Check your province and city before submitting.', or says
'We could not detect your province and city. Select them below to continue.'
when the network gives no South African place on the lists (common on mobile
networks and VPNs). Proposed: keep. Decision: awaiting owner.
### 61. Real view counts and likes (roadmap P6)

The owner decided on 19 November that view counts and likes show at launch.
They were hidden (group 6) because the live backend stored neither. Database
update `20261119172135_post_views_and_likes.sql` now stores them, and the
website reads and records them, but only while the switch
`SHOW_ENGAGEMENT_TOTALS` (`src/lib/hidden-features.ts`) is on. It stays off in
production until the owner approves showing them; it is on in the launch
configuration build. Turning it on brings back the 27 October look: the eye
icon with 'N views' on post pages, cards, the full-screen viewer, Video mode and
the owner's post lists, and the heart with its count, in the same places and
style. Three things are new and visible:

- Cloudflare's 'Verify you are human' box can appear in the bottom-right corner
  (16 px from the edges, above the page) on a signed-out visitor's first
  counted view or first like, only when Cloudflare needs a click; it closes
  once solved. Most visitors never see it.
- If that check cannot be completed, the like is not saved, the heart goes
  back, and screen readers hear 'Confirm you are not a robot to like posts'.
- A signed-out like from a browser seen for the first time counts in the
  public total after 10 minutes; the visitor sees their own like at once.

What is new behind the switch: anyone can like a post, signed in or not, and
the like stays (signed in, one per account; signed out, one per browser; tapping
again unlikes). A view counts only when the post's own page, or the full-screen
viewer on it, has been visible for 2 seconds, once per browser per post in 24
hours, never the owner's or staff's own views, crawlers or prefetches. The
browser identifier is a cookie the website signs, so made-up identifiers never
count. The privacy notice's view-counting paragraph and the PAIA manual now say
what is stored (for views a hash under a daily code, deleted within 3 days; for
a signed-out like a keyed hash for as long as the post is up; a signed-in like
with the account, in the data export) instead of a network address hash for 90
days.

Owner questions: (1) show view counts and the like button at launch, as
decided, by switching `SHOW_ENGAGEMENT_TOTALS` on? This first needs the Worker
secret `ENGAGEMENT_COOKIE_SECRET`; without it nothing is counted. (2) Is the
privacy notice wording right (lawyer to confirm)? Also the group 61 part of the existing rows for the post pages, the like button, the owner's post lists, the privacy notice and the PAIA manual. Decision: awaiting owner.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/hooks/use-track-content-view.ts` | wording-behaviour | Group 61: a post page's own view is sent once the page has been visible for 2 seconds in the foreground (a hidden tab restarts the countdown), as the full-screen viewer already did; it was sent as soon as the page opened. | Nothing visible; a page opened and left at once is no longer a view | keep | awaiting owner | 2026-11-19 | d51b964b3295 |
| `src/components/immersive/immersive-detail-gate.tsx` | wording-behaviour | Group 61: when the desktop viewer fails and the classic page is shown instead, its view waits for the same 2 seconds visible. | Nothing visible | keep | awaiting owner | 2026-11-19 | 0f4d475277b3 |
| `src/components/immersive/immersive-detail-gate.test.tsx` | test | Group 61: the test follows the 2-second view helper. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-19 | 713af26df048 |
| `src/components/engagement/viewer-challenge.tsx` | visual | Group 61: new. Gets a signed-out browser its view-and-like identifier when the server asks for it: the site's own Turnstile widget (action engagement_viewer, 'interaction-only'), then /api/engagement/viewer; one check at a time, none for 10 minutes after a failure. | Nothing in most cases. When Cloudflare needs a click: its 'Verify you are human' box in the bottom-right corner (16 px from the edges, above the page), on a signed-out visitor's first counted view or first like; it disappears once solved. | keep | awaiting owner | 2026-11-19 | 9240c4baf58b |

### 59. Video seek bar and time (roadmap M10.7, first part)

Roadmap M10.7, first part only; captions come later with managed video.
Decision: approved by owner 2026-11-20. The before and after pictures are in the
pull request.

- Post pages and the desktop viewer (`ProfileVideoPlayer`): the seek bar keeps
  its look and place (the same thin red track; measured at the same height on
  phone 375 and desktop 1280 before and after), but can be grabbed anywhere in
  a 24 px tall strip (was 6 px, WCAG 2.5.8). On a touchscreen a sideways drag
  can start anywhere on the bar and follows the finger (the page does not move
  meanwhile), and a tap jumps there when the finger lifts; a finger that moves
  up or down scrolls the page as before, without moving the video. The Left and
  Right arrow keys move 5 seconds (were 0.1 s); Home and End go to the start
  and the end. A keyboard user sees a gold focus ring around the bar, as on
  Video mode's other controls. The time label already showed
  'current / length'; it now shows the real length when the video loaded before
  the page was interactive (it read '0:04 / 0:00', and the bar could not move).
- Video mode on phones (`/video-mode`): new. Under the Details, call, share and
  More buttons, a thin gold seek bar (the viewer's accent, as in its media
  position segments) with the time and length beside it, e.g. '0:12 / 0:45'.
  It shows and hides with the other controls (pausing brings it back), stays
  while it is being dragged, and the post details sit about 36 px higher to
  make room.
- Posting and edit forms (Market, Business, Tourism & Events): after the
  owner-approved length guidance, the video field's help text adds 'Many people watch without sound: show key details (price, place, phone number) on screen in the video itself.'

Text outside the checked scope: `src/lib/media/video-time.ts` (the time label,
'0:12 / 0:45'; past an hour '1:02:03'), `src/lib/media/video-length.ts` (the
tip's words) and two browser checks (`e2e/foundation/video-mode.spec.ts`,
`e2e/foundation/immersive-viewer.spec.ts`).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/ui/video-seek-bar.tsx` | visual | M10.7: one seek bar for every player: the browser's slider in a 24 px tall strip. On a touchscreen a mostly sideways drag follows the finger anywhere on the bar and keeps the page still; a tap seeks when the finger lifts; an up or down swipe is left to the page (the slider's own jump on touch down is ignored), and nothing is held from the page while the length is unknown. Arrow keys move 5 s. | Seek bars: the same thin track, with a 24 px tall area to grab; scrolling past a video on a phone no longer jumps it; Left and Right move 5 seconds; a gold focus ring for keyboard users; screen readers hear '0:12 of 0:45'. | keep | approved by owner 2026-11-20 | 2026-11-19 | 2ded6d1ad879 |
| `src/components/ui/video-seek-bar.test.tsx` | test | M10.7: the hit area is at least 24 px, the bar states position and length and has a focus ring; a vertical swipe neither seeks nor blocks the page, a sideways drag and a tap seek (clamped to the ends), nothing is blocked before the length is known, and arrow key presses move 5 s while Home and End stay the browser's. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-19 | 13bb27a9e5d1 |
| `src/components/ui/profile-video-player.tsx` | visual | M10.7: uses the shared seek bar (margins keep the track and buttons where they were) and time label; reads the video's length on mount when its metadata loaded before the page was interactive. Group 116: the native poster uses the poster's own media URL (`normalizeMediaUrl`); the removed `getVariantUrl` gave that same URL for every `media/<uuid>` poster. | Post pages and the desktop viewer: the seek bar is easier to grab (24 px tall area, same look and place); the time label shows the real length instead of '0:00'. Group 116: nothing (same poster URL). | keep | approved by owner 2026-11-20; group 116 part approved by owner 2026-11-26 | 2026-11-19 | cff6ff16f6d5 |
| `src/components/ui/profile-video-player.test.tsx` | test | M10.7: the label reads '0:12 / 0:45', the bar is at least 24 px and seeks, and the length is read from a video that loaded before the player mounted. Group 116: the poster test uses a real `media/<uuid>` key and expects its media proxy URL. | Nothing (not part of a page) | keep | approved by owner 2026-11-20; group 116 part approved by owner 2026-11-26 | 2026-11-19 | 3feb360c99a8 |
| `src/components/video-mode/video-mode-seek.tsx` | visual | M10.7: new seek bar and time for the video on screen in Video mode; it follows the active video element through the page, so retries and swipes need no extra wiring. | Video mode: a thin gold seek bar with '0:12 / 0:45' under the post's buttons, while a video is on screen. | keep | approved by owner 2026-11-20 | 2026-11-19 | e223e23b152c |
| `src/components/video-mode/video-mode-seek.test.tsx` | test | M10.7: shows and seeks the active video's time, follows a video that appears later, and ignores other videos. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-19 | bbc11a3e2209 |
| `src/components/video-mode/video-mode-viewer.tsx` | wording-behaviour | M10.7: a seek bar with the time and length sits under the post's actions while a video is on screen; moving a finger or pointer along the seek bar counts as activity, so the controls do not step aside (after 6 s) in the middle of a drag. Group 57 (row A16): the province picked in the viewer is no longer also saved in a cookie: only the removed 'province first' showroom read it. | Video mode: under the Details, call, share and More buttons, a thin gold seek bar with '0:12 / 0:45' beside it, shown and hidden with the other controls (see `video-mode-seek.tsx`); the post details sit about 36 px higher to make room; the controls stay on screen while the seek bar is being dragged. Group 57: nothing (the province filter works as before). | keep | approved by owner 2026-11-20; group 57 part awaiting owner | 2026-11-19 | 443d570e66ec |

### 60. Multi-listing packages: the small part-one gaps (Pricing v2 P4a)

Database update 20261119151152_package_gap_fixes (apply first). The owner's
decision D6 of 19 November 2026 and drafts n1 and n7 (19 November). Members
see nothing new while Multi-listing packages are not on sale (the owner's
switch in the database).

- 'Payment confirmed' for a package (draft n1): after paying for a package
  online, the payment result page reads 'Your package is active' and 'Payment
  confirmed. Your <n> slots are ready to use now.', then Slots, Started
  '<date, time> (SA time)', Ends '<date, time> (SA time)', New posts 'Up to <n>
  every 30 days', Paid 'R<amount> online', the note 'Nothing renews
  automatically.', 'Create a post' and 'Go to My slots', and, when the member
  also holds Individual slots, 'Posts in your Individual slots can move into the
  package when those slots end, while it has free places.' (draft n1 said 'Your
  Individual slots keep running and move into the package when they end.', which
  promised more than a full package can do). A package confirmed while the page is
  open reloads the page's data once to show it. Every other payment keeps the
  general 'Payment confirmed' card. Draft n1's 'We remind you 14 days and 3 days
  before it ends.' is left out until package reminders exist: P4d adds it back
  with the reminders. The
  draft's add and renewal variants ('20 slots added', 'renewed from 24 Dec')
  come with P4b and P4d.
- 'Choose your package' (D6): while the member has an unpaid invoice for
  Individual slots, 'You have an unpaid invoice for Individual slots
  (VM-2026-000187). If you pay by bank transfer after your package starts,
  those slots run beside the package until their own end. See Invoices.'
  (plural for more than one).
- Paying for a package that was started before a package invoice was paid
  (or before a package began): the database no longer sends it to Ozow, and the
  checkout shows the package checkout's existing words, 'This account already
  has a Multi-listing package. Its slots are on My slots.' or 'Your package
  invoice is not paid yet. Pay it from Invoices, or email
  billing@verifymzansi.com to cancel it first.' (`billing-runtime.ts`).
- Staff only, Payments & Refunds: a 'Needs attention' card (the right-hand
  column of draft n7) while a package move keeps failing, under the title
  'Moves are checked every minute. A post that never moves falls into the 3-day
  grace when its package ends.', one item each: 'Post could not move
  into the package' (or 'out of the package', or 'The package was busy'),
  'Post <reference> · tried <n> times since <date, time> · reason: busy' (or
  'error <code>'), and 'Package of <short name> · ends <date, time> (SA time)'.
  The post is named by a short reference (the first 8 characters of its id),
  never its title: a paused post is not public. A stuck move (failing for over 30
  minutes, or repeatedly in the package's last day) is shown in red, others in
  gold. Nothing is shown while nothing fails. The
  draft's 'Retry now' is left out: the sweep retries every minute by itself.
  The rest of draft n7 (the staff package page) is part A5. The draft's
  'Bank transfer for an invoice issued before the package' item needs no card:
  staff record and confirm it with 'Record a bank transfer' as for any invoice.

Decision: approved by owner 2026-11-19.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/billing/package-confirmed.tsx` | visual | Group 60: the package confirmation (draft n1). Group 62: the add variant of draft n1. | After paying for a package: 'Your package is active' with slots, start and end in SA time, new posts per 30 days, the amount paid, 'Nothing renews automatically.', 'Create a post' and 'Go to My slots' (the reminder sentence comes back with P4d), and for a member with Individual slots 'Posts in your Individual slots can move into the package when those slots end, while it has free places.' Group 62: after paying for added slots: 'Slots added', 'Payment confirmed. <n> slots added, <m> in total, all ending <date>.', then 'Slots added', 'Slots in total', 'All end', 'New posts' and 'Paid'. | keep | approved by owner 2026-11-19; group 62 part awaiting owner | 2026-11-20 | 851ebde2275f |
| `src/app/billing/success/page.tsx` | rewiring | Group 60: reads whether the payment bought a package and, once delivered, the package it opened. | Nothing by itself (see `package-confirmed.tsx`). | keep | approved by owner 2026-11-19 | 2026-11-19 | af1f9a821fab |
| `src/app/billing/success/package-refresh.tsx` | helper | Group 60: reloads the page's data once when a package payment is confirmed while the page is open. | Nothing by itself: the package confirmation replaces the general one without a manual reload. | keep | approved by owner 2026-11-19 | 2026-11-19 | 46d5133af172 |
| `src/components/admin/commercial/package-move-attention.tsx` | visual | Group 60: staff see package moves the sweep keeps failing to make (part of draft n7). | Staff only, Payments & Refunds: the 'Needs attention' card described in group 60 (posts by short reference, never by title), only while a move fails. | keep | approved by owner 2026-11-19 | 2026-11-19 | f9e9342487b1 |
| `src/components/admin/commercial/package-move-attention.test.tsx` | test | Group 60: checks the card is absent with nothing failing, and the stuck and not-yet-stuck items. | Nothing (not part of a page) | keep | approved by owner 2026-11-19 | 2026-11-19 | fb20fee57798 |

### 62. Add slots part-way through a package (Pricing v2 P4b)

Database update 20261120045404_package_add_slots (apply first). The owner's
decision D1 of 19 November 2026; approved drafts p4-03 (Add slots) and p4-04
(too late); draft n2 (by invoice) and the add variant of draft n1 are new.
Members see nothing new while Multi-listing packages are not on sale (the
owner's switch in the database, switched on at launch).

- My slots, package card: an 'Add slots' button (outline, on the green card)
  while 7 or more whole days of the package are left. It opens the new page
  `/billing/package/add`.
- 'Add slots' page (draft p4-03): 'Multi-listing · <n> slots', 'Add slots',
  'Total today R<amount>' with '<n> slots × <d> days at R100 per 30 days', a
  'Slots to add' box with minus and plus, '<n> → <m> slots', then Details: 'New
  slots start: On payment', 'They end: With your package, <date>', 'Days
  charged: <d> (whole days left today)'; the box 'My added slots start now and
  end with my package; the 7-day cooling-off does not apply because the service
  starts immediately. Refunds' (wording approved by the owner on 20 November
  2026) and 'Pay R<amount> securely', 'Back to My
  slots'. The price is one slot's price for the whole days left (R100 × days /
  30, rounded to the cent) times the number of slots (R2 533.40 for 20 slots
  and 38 days; the owner approved this rounding on 20 November 2026), so an
  invoice shows 'slots × unit price = total'. The draft's 'Team' row is left
  out until the team exists (P4c).
- By invoice (draft n2): above R1 300 (Ozow's maximum) or 100 slots in all,
  while 10 or more days are left: 'Above R1 300 or 100 slots in all, we send an
  invoice. Pay it by bank transfer within 3 days.', 'New slots start: When your
  payment clears', 'Price: Fixed now, even if it clears later', 'If the money
  arrives after your package has ended, we refund it in full.', the invoice
  box (the existing invoice sentence 'My slots start as soon as this invoice is
  paid; …', approved by the owner on 20 November 2026) and 'Ask for an
  invoice'; afterwards 'Invoice requested for <n> slots (R<amount>). We will let
  you know when it is ready; then pay it from Invoices.' Between 7 and 9 days
  left, a total that needs an invoice shows 'Above R1 300 or 100 slots in all,
  slots are added by invoice while 10 or more days are left. Add fewer slots.'
- Too late (draft p4-04): with fewer than 7 days left, '<n> days left. Slots can
  be added while 7 or more days are left.' and 'Back to My slots'. The draft's
  'Renew package' button comes with renewals (P4d).
- Other states: no running package ('Slots are added to a running Multi-listing
  package. You have none now.'), ID review not accepted (as on 'Choose your
  package'), an unpaid package invoice ('Your package invoice is not paid yet.
  Pay it from Invoices before adding more slots.').
- After paying (draft n1, add variant): 'Slots added', 'Payment confirmed. <n>
  slots added, <m> in total, all ending <date>.', then 'Slots added', 'Slots in
  total', 'All end <date, time> (SA time)', 'New posts', 'Paid'.
- Staff only, Payments & Refunds, 'Package invoice requests': an added-slots
  request reads 'Add <n> slots · priced for <d> days · R<amount>', then
  'Package ends <date, time> · <n> whole days left now' and, when fewer days are
  left than priced, '· issued now, the invoice is for <n> days at their lower
  price'. 'Issue invoice' asks for no days to pay on an added-slots request: it
  shows 'Due <date> (3 days after it is issued, or the package's last day if
  sooner)', the date the database sets (owner's decision of 20 November 2026).
  It warns 'The customer's package has
  ended: decline this request.' or 'Fewer than 10 days of the customer's
  package are left: decline this request.' (a new package request keeps its
  warning).
- The invoice (member and staff, printable): on an invoice for added slots the
  line under the description reads '<n> days added. The slots run from the day
  this invoice is paid until the package ends on <date>.' instead of 'Each slot
  runs <n> days from the day this invoice is paid.'

Decision: awaiting owner.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/billing/package/add/page.tsx` | rewiring | Group 62: the 'Add slots' page, hidden (not found) while packages are not on sale; reads the member's running package and the online limit. | Nothing by itself (see `package-add-checkout.tsx`). | keep | awaiting owner | 2026-11-20 | 505bcd9bd30e |
| `src/app/billing/package/add/package-add-checkout.tsx` | visual | Group 62: the 'Add slots' page (drafts p4-03, p4-04, n2). Group 96: the consent box links the Terms too (ECTA s43), through the shared `checkout-terms-links.tsx`. Group 114: says no VAT is charged under the total. | The 'Add slots' page and its states described in group 62. Group 96: after the consent text, 'Terms · Refunds' instead of 'Refunds'. Group 114: Add slots: a small grey line 'No VAT is charged.' under the total. | keep | awaiting owner; group 96 part approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 27653e6c4882 |
| `src/app/billing/package/add/package-add-checkout.test.tsx` | test | Group 62: checks the price for the days left, paying online, asking for an invoice, the closed and too-late states and the blocks. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-20 | 565bca1ec99c |

### 63. Sign-up mode in the database (item 7)

Database update 20261120040242_signup_mode_member_invitations (apply first).
The sign-up mode (invite only, or open) is held in the database and only the
database owner changes it; member invitations are kept apart from
administrator invitations, and an invitation admits one sign-up. Nothing
changes on screen while sign-up is by invitation: the registration reply keeps
its wording. Once the owner opens sign-up, a Google sign-up that the sign-up
hook refuses for its email domain (a blocked disposable-address service or a
reserved name) returns to the sign-in page with 'This email can't be used to
register' and 'Sign up with a different email address or Google account.'
instead of the generic 'Authentication failed' message, and the profile page's
email change answers 'This email address can't be used. Use a different
address.' for such an address (an API answer the page already shows). No file
rows of its own: the group 63 part of the login page's rows in group 2.

Decision: approved by owner 2026-11-20.

### 64. Toasts clear of form buttons on phones

On a short phone (375 x 667) the toast shown after an action, such as 'Code
sent' on 'Verify your phone number' or 'Password change failed' on the
profile's Security tab, sat near the bottom of the screen for 5 seconds, over
the 'Verify' and 'Update password' buttons. The empty strip below it, kept
clear of the bottom navigation, also caught taps. A tap on the button reached
the toast list instead.

- Phones (narrower than 768 px): toasts appear at the top of the screen, 16 px
  from the edges, and slide in from the top. While a toast shows (about 5
  seconds, longer while the pointer rests on it) it covers the header:
  the logo, search and menu underneath cannot be tapped until it closes or is
  swiped away. Their look (colours, border, corners, shadow, words, close
  button, swipe to dismiss, 5 seconds) is unchanged.
- Tablets and desktops (768 px and wider): same place and look, bottom right
  as before (measured at 1280 x 800: same place and size).
- Every screen size: only the toast itself takes taps. The empty space of the
  toast list around it no longer catches them: a tap there reaches the page.

Text outside the checked scope: the browser checks for the phone code and the
password change now run on a 375 x 667 screen in every browser lane (desktop
Chrome too), keep the toast open, check that the toast and the 'Verify' or
'Update password' button do not overlap on screen, and click the button while
the toast is still showing (`e2e/foundation/support/toasts.ts`), instead of
waiting for it to close. The before and after pictures are in the pull
request.

Also in this group: the unit check that a payment that is not a package never
reloads the payment result page (`payment-status-panel.test.tsx`, its row is in
group 5) now waits for the status request and its effects to settle before
checking. Nothing changes on screen.

Decision: approved by owner 2026-11-20.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/ui/toast.tsx` | visual | Group 64: on phones toasts covered the button tapped next ('Verify', 'Update password') and the empty strip under them caught taps. Below md the toast list sits at the top of the screen above the header; md and up keep the bottom-right place. At every size the list lets taps through outside the toasts. | Phones: toasts at the top of the screen instead of near the bottom, sliding in from the top, covering the header for about 5 seconds; same look. Tablets and desktops: same place and look; taps on the empty space around a toast reach the page. | keep | approved by owner 2026-11-20 | 2026-11-20 | 1e90302c7356 |

### 65. Member invitations (staff)

Database update 20261120040242_signup_mode_member_invitations (already
applied, PR #304). A new staff page, `/admin/member-invitations`, for the
commands `api.invite_member`, `api.revoke_member_invitation` and
`api.list_member_invitations` (capability `member:invite`: admins only, with
an authenticator check in the last 12 hours). Built from the plan and pictures
the owner approved on 20 November 2026
(`docs/engineering-review/MEMBER-INVITES-SCREEN-PLAN-2026-11-20.md`, not
published).

- Staff menu, Platform section, above Feature flags: 'Member invitations' with
  a person-plus icon. Other roles do not see it; the page sends them to the
  staff home.
- Intro: 'Sign-up is by invitation only. To make someone staff, use Staff
  roles.' (open sign-up: 'Sign-up is open to everyone, so invitations aren't
  needed.'). A member invitation never gives staff access, and the page and
  its code are kept apart from administrator invitations, which have no
  screen.
- 'Invite a member': one email field and an Invite button. On success: 'We
  don't email them', the sign-up link and 'Copy link' (it says 'Copied' for
  2 seconds after a copy); the new row is highlighted at the top. Inviting an
  address still waiting renews it for 30 days and says so. Refusals: the
  address has an account (the field is marked red), today's limit of 200,
  not an admin, not a valid address. An expired authenticator check sends the
  admin to verify again and back.
- 'Invitations', newest first (up to 500): the email, one status (Waiting to
  join, Joined, Withdrawn, Expired) and one date. 'Withdraw' only on waiting
  rows, after 'Withdraw this invitation?'. Empty: 'No invitations yet'.

Not in the pictures: the dialog has the site's usual close button in its
corner, and a withdrawal that fails shows its reason inside the dialog.

Decision: approved by owner 2026-11-20 (design and pictures); the built screen
goes to the owner with after-pictures.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/member-invitations/page.tsx` | visual | Group 65: the new Member invitations page (admins only): reads the invitations and the sign-up mode through the foundation commands. | Admins: the page header with the intro and the Staff roles link; a message when the list cannot be loaded. | keep | approved by owner 2026-11-20 | 2026-11-20 | 234d436f5cc4 |
| `src/app/admin/member-invitations/member-invitations-client.tsx` | visual | Group 65: the invite form, the result messages with the sign-up link, the invitations list and the withdraw confirmation. Group 93: its request code moves to a shared helper (src/lib/admin/post-staff-command.ts), also used by the Free credits page. | Admins: everything described in group 65. Group 93: nothing (same look and steps). | keep | approved by owner 2026-11-20; group 93 part awaiting owner | 2026-11-22 | d256647883db |
| `src/app/admin/member-invitations/member-invitations-client.test.tsx` | test | Group 65: checks the list, the empty state, inviting, renewing, each refusal, the re-verify redirect and withdrawing. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-20 | 10677f8a4c39 |
| `src/app/admin/member-invitations/page.test.tsx` | test | Group 65: checks the page guard, both intros, the re-verify redirect and the failed-read message. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-20 | 4b2a5ff7c37c |

### 66. One main button per screen (button hierarchy)

The owner approved the button proposal on 20 November 2026: too many filled
green buttons competed on each page. Each screen now has one filled main button
(brand green; on a dark-green band it is gold, the dashboard banner's gold).
Other actions are outlined (white with a grey edge) or text links. Red stays
only for the final "yes, delete" in a confirm box. Equal choices get equal
buttons. The phone bottom bar's round green '+ Post' stays filled.

- Header: 'Register' and '+ Post' are a light-green tinted pill.
- Pricing: the three terms are equal and outlined, no highlighted card; 'Post
  for free' in the hero card is the main button; no footer band.
- Gold on dark bands: the footer band's 'Post for free'; Advertise hero and
  closing band; Verification help and Business verification help heroes;
  Trust & Safety hero ('Report a concern'). Black buttons become outlined; no
  footer band on Advertise.
- Sections: the create button by the title is outlined; the empty box's button
  is the main one. Post pages: 'Show contact number' is the main button,
  'WhatsApp' and 'Send an enquiry' outlined; the phone bottom bar fills only
  its first button.
- Dashboard and blocked steps: while the member has an ID review step to do,
  its button is the main one ('New post' outlined in the banner; gold again
  while the review is in progress); no second 'Create your first post';
  checkout and My slots fill 'Go to my ID review' / 'Finish my ID review'
  while it blocks buying; My posts' 'New post' is outlined at the top on
  every tab (with no posts, the empty list's 'Create your first post' is the
  main button).
- Terms and Privacy: e-mail addresses are text links (PAIA had none drawn as a
  button). Safety Centre: the hero's 'Report a problem' is gold on its dark
  band and the second one is a text link; the red 'Call SAPS 10111' stays
  filled as an emergency exception.
- Home: the About section's 'Post for free' is outlined; the footer band's
  gold 'Post for free' is Home's main button.
- No black (owner, 20 Nov): no button or chip is filled black. Selected
  chips and tabs and the former black buttons use a light version of the
  Tourism & Events teal (teal 50 with teal 800 words and a thin teal edge;
  dark mode teal 950 at 40% with teal 200 words): the dashboard phone strip's
  selected item, My posts' 'All areas', the dashboard posts box filter, the
  create page's buttons and Advertise's step numbers. Dark scrims and controls
  drawn over photos and videos are not changed.
- Code: the Button 'default' and 'trust-verified' styles are one; 'ink' is
  retired; a 'tinted' style is added. A browser check
  (`e2e/foundation/one-main-button.spec.ts`, outside the checked scope) fails
  when a public page shows two filled main buttons on one screen, any in the
  site header, or more than one in the footer; on Home, where the footer
  band's button is the main one, it fails on any filled button in the page
  body. Red buttons are not counted.

Decision: approved by owner 2026-11-20: the 7 changes; the 3 follow-ups
(Home's About 'Post for free' outlined, the Safety Centre hero's 'Report a
problem' gold, My posts' 'New post' on every tab, filled when the member has
posts and outlined only beside the empty list's 'Create your first post');
and the no-black rule (owner: no black, light tourism colour), which the
owner gave directly: the light Tourism & Events teal everywhere black was
used on a button or chip. The dark controls over photos and videos, the logo
tiles and the flag stripe are not buttons or chips and stay as they are.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/ui/button.tsx` | visual | Group 66: one filled main button per screen. 'default' and 'trust-verified' are one filled brand-green style; 'ink' (black) is retired; a light-green 'tinted' style is added for the header. | Filled green buttons look as before. Buttons that used the plain default style: in dark mode a slightly deeper green (brand green 500) with dark words, and when disabled a pale green instead of grey (the look 'trust-verified' buttons already had). The black buttons are gone (see their pages). | keep | approved by owner 2026-11-20 | 2026-11-20 | 22e105a29a5e |
| `src/components/ui/button.test.tsx` | test | Group 66: checks default and trust-verified are the same filled green, 'tinted' is not filled, 'ink' is gone, and a caller's gold wins in dark mode. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-20 | bfb6ae3cccdc |
| `src/components/brand/brand-surface.tsx` | helper | Group 66: the dashboard banner's gold as one shared style for the main button on a dark-green band. | Nothing by itself (see the pages that use it). | keep | approved by owner 2026-11-20 | 2026-11-20 | 2f4db4254175 |
| `src/components/brand/index.ts` | helper | Group 66: exports the shared gold style. | Nothing by itself. | keep | approved by owner 2026-11-20 | 2026-11-20 | 146383f4dcf2 |
| `src/components/layout/footer.tsx` | visual | Group 66: the footer band's 'Post for free' sits on the dark-green band, so it is gold; pages whose own hero or closing band offers 'Post for free' can hide the band. Group 101: the owner softened the positioning statement ('Soften it', 25 November 2026). | Every page's footer band ('Got something to sell, share or host?'): 'Post for free' is gold (the dashboard banner's gold, dark words) instead of bright green; 'How verification works' unchanged. Pricing and Advertise hide the band. Group 101: Footer, under the logo: 'A South African platform connecting people with businesses, products, services, tourism and events from ID-reviewed posters. What we check' (was '... connecting people with verified businesses, products, services, tourism and events.'); the 'What we check' link stays. | keep | approved by owner 2026-11-20; group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | ce75676aa118 |
| `src/components/layout/footer.test.tsx` | test | Group 66: checks the gold 'Post for free' and that a page can hide the band. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 | 2026-11-20 | 6ba1481f40f9 |
| `src/components/admin/moderation/moderation-queue-client.tsx` | visual | Group 66: keeps its look after the Button merge. | Nothing: staff only, 'Approve' keeps its green in dark mode. | keep | approved by owner 2026-11-20 | 2026-11-20 | 1b726e95d5fc |
| `src/components/ui/selected-state.ts` | helper | Group 66 (owner: no black, light tourism colour): one shared light-teal style for a selected chip, tab or small action (teal 800 on teal 50, about 7.3:1; teal 200 on the dark page above 12:1). | Nothing by itself (see the files that use it). | keep | approved by owner 2026-11-20 | 2026-11-20 | 577f523b8ae7 |
| `src/components/dashboard/area-filter.tsx` | visual | Group 66 (owner: no black, light tourism colour): the selected 'All areas' chip was black. | My posts: the selected 'All areas' chip is light teal with dark teal words and a thin teal edge instead of black with white words; the other areas' selected colours are unchanged. | keep | approved by owner 2026-11-20 | 2026-11-20 | 9b7b25027b14 |

### 67. Daily limit on SMS codes: message

Server message only: no file in the checked scope changes, so this group has no
file rows. Launch checklist item 12 (launch assurance LA-A15) adds a limit on
SMS verification codes for the whole site per South African day (database update
`20261120074411_sms_daily_limit.sql`, 500 codes a day, approved by the owner). When it is reached, asking for a code on 'Verify your phone
number' (`/verification`) or 'Complete your profile' sends no SMS and shows,
where the send errors already appear under the number:

> We can't send codes right now. Please try again later.

The words are new (owner rule 4). The pages show the server's message as they
already do for other send errors; no page file changes. A code already sent
before the limit still works. Text outside the checked scope: the message in
`src/lib/utils/phone.ts` (`PHONE_CODES_UNAVAILABLE`), returned by
`src/app/api/foundation/phone/_lib/handle.ts` with status 503.

Decision: approved by owner 2026-11-20 (the limit of 500 and the wording as
written).

### 68. Old backend retired, part 2 (item 10)

Six pages stop using the old backend's client (checklist item 10, part 2).

- Post pages (listings and events): the old 'is this the poster?' check is
  removed. It only decided whether the poster sees their own number in the
  page, and that number is never sent (always empty), so the public pages read
  no session. Nothing on screen changes.
- Leads: the signed-in check reads the account the sign-in gate verified.
  Nothing on screen changes.
- Create a post: the signed-in check and the verification status come from the
  live backend. Before, the page always started as 'unverified' on production
  (the old verification tables are empty) and corrected itself once the browser
  asked again. Now a verified member sees the section cards without the
  'Verification required before posting' box, and a member whose ID is under
  review or was turned down sees 'Your verification is being reviewed...' or
  'Your verification wasn't approved...' straight away. If the status cannot be
  read, the page shows 'Finish verification to start posting.' and the browser
  asks again, as before.
- Pricing and Billing: the old read of the free-post days is removed. The texts
  keep the fixed defaults production already showed ('7 days from approval').
  Before and after pictures of both pages, on a desktop and a phone, are
  identical pixel for pixel.

Decision: approved by owner 2026-11-20 (owner question: 'Approve the Create a post change: the right verification note shows at once, with no flash?'; answer: 'Approve').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/post/create/page.test.tsx` | test | Group 68: the page test runs on the live backend's session and verification read: one check per status (verified, under review, turned down, sent back to fix, not finished), a failed read, and 403/503 refusals that are not treated as signed out. Group 73: signs in with a full account (the read now checks the account). Group 87: checks Start from a template with the switch on and a running package, and none without templates, without the package, when the read fails or with the switch off. Group 87: checks the ended-package line, the turned-off Use and the working menu. | Nothing (not part of a page) | keep | approved by owner 2026-11-20; group 73 part approved by owner 2026-11-21; group 87 part approved by owner 2026-11-22 | 2026-11-20 | 605816d604c2 |

### 69. ID photos with the camera only, Continue on your phone, names as on the ID

Didit plan, build step 2 (the owner approved the plan and its pictures 01, 01b,
01c, 01d and 08 on 20 November 2026). Database update
`20261120131212_camera_capture_handoff.sql` (pending: apply first). Works on
today's Manual setting; nothing about the automatic check is shown.

- ID details: the name labels read 'All first names (as on your ID)' and
  'Surname (as on your ID)', with the hint 'Type every first name in the same
  order as your ID. Your verified name can't be changed later.'
- 'Photo of your ID' says 'Taken with your camera here. Photos from your
  gallery or files can't be used.' The camera asks for the back camera at
  1920 x 1080; the live picture shows short hints ('Too dark: move to better
  light', 'Too much glare: tilt the card a little', 'Hold still'; read out to
  screen readers), a light button when the phone has a torch, and the line
  'Lay the card on a dark, flat surface in good light. Fill the frame and keep
  all four corners in view.' The photo is saved as a JPEG (quality 0.85, long
  edge at most 2,000 px; selfie 1,280 px).
- 'Check your photo' (01b): the photo with 'Photo taken', three lines (all
  four corners in view; sharp enough to read; no strong glare), 'Can you read
  your name and ID number in the photo? If not, retake it.', and Retake / Use
  this photo.
- No file or gallery upload anywhere: the 'Or upload a photo' box and its
  texts are gone from the ID and selfie steps.
- Camera problems (01c): blocked: 'Your camera is blocked for VerifyMzansi.'
  with steps for Android (Chrome), iPhone (Safari) and inside WhatsApp,
  Facebook or Instagram; no camera: 'We can't find a camera on this device.';
  busy: 'Close other apps or tabs using the camera, then try again.' Buttons
  'Try the camera again' and, on a computer, 'Continue on your phone'. Inside
  those apps a note says how to open the page in Chrome or Safari.
- Continue on your phone (01d): on a computer the step shows a QR code (single
  use, 15 minutes, only for this account), 'No QR scanner? Sign in on your
  phone and open Get verified', 'Waiting for your phone…', Back and New code;
  the page moves on by itself when the phone has sent the photos. The phone
  opens `/verify/continue`: 'Continuing your check from a computer. You're
  adding ID photos for Thando D.', the time left, the camera, then 'All done'.
- Decision N (owner, 20 November 2026: "Yes, require sign-in"): the phone must
  be signed in as the same account. The computer says 'Sign in on your phone
  with the same account, then take the photos.' and 'Never send this code to
  anyone.'; a signed-out phone shows 'Sign in on this phone' with that line and
  a Sign in button, and comes back to the page after signing in (the link's
  token waits in that browser tab, never in a web address). A phone signed in
  as another account is told so. Going Back and choosing Continue on your phone
  again shows the same code until New code.
- Each photo needs the camera to have started on the page in the last 10
  minutes; an older photo shows 'That photo is more than 10 minutes old. Please
  take it again.' A selfie under 480 px is refused like a small ID photo.
- Your privacy: adds 'ID photo deleted after 1 month'; the link reads 'What we
  keep, and for how long' (privacy notice, retention section). What happens
  next: 'Our team checks your ID, usually within 1–2 working days'.
- Wording without 'upload' on the page (for example 'Sending…', 'Your ID photo
  wasn't sent', 'Not taken yet') and on the help page (camera-only help, in-app
  browsers, Continue on your phone).

Differences from the pictures: the 'Once verified: selfie, ID number, names
and phone kept until 5 years after your account closes' line is not shown:
today the selfie and ID number are deleted with the ID photo (privacy notice),
and the line ships with the retention update. 'All four corners in view' has a
plain circle, not a tick: the page cannot check corners, so the member does.
'Which ID do you have?' shows before the camera opens, not while it runs. The
paused-check banner of picture 08 belongs to the automatic check (later).

Decision: approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (the built screens; owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/ui/camera-capture.tsx` | wording-behaviour | Group 69: camera only (no file input), back camera at 1920 x 1080 for the ID, JPEG 0.85 with long-edge limits, live hints, torch, the ID photo check before use, the camera-problem screens and Continue on your phone. Review: 'The camera is still starting. Try again in a moment.' when Take photo is pressed before the first frame. | ID and selfie steps: everything described in group 69 for the camera. | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | 95249703fb07 |
| `src/components/ui/camera-capture-helpers.ts` | helper | Group 69: camera error mapping, in-app browser check, quality hints and photo size, kept apart for tests. | Nothing by itself | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | 68187ed8249d |
| `src/components/ui/camera-capture-helpers.test.ts` | test | Group 69: error mapping (blocked, none, busy), in-app browsers, hints and sizes. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | 473eacdfa5d9 |
| `src/components/ui/camera-capture.test.tsx` | test | Group 69: no file input, the new camera-problem texts, Continue on your phone on computers only, the in-app note, the ID photo check and the JPEG settings. Review: the camera-starting message. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | d20c2af2cea3 |
| `src/app/verification/continue-on-phone.tsx` | visual | Group 69: the computer's Continue on your phone panel (QR code made by the server, waiting, Back, New code). Decision N: the same-account sign-in line, 'Never send this code to anyone.', and the code reused until New code. Review: the reused code is kept by the page, keyed by a SHA-256 digest of the details (never the typed ID number). | Get verified on a computer without a usable camera: the panel of picture 01d. Decision N: those two lines. | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | d77271fbec2b |
| `src/app/verification/continue-on-phone.test.tsx` | test | Group 69 review: the phone code is shown again after Back from the page's own store, keeps no ID number, and is new for other details or another page. | Nothing (not part of a page) | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | f176702b82ab |
| `src/app/verification/verification-ui.tsx` | wording-behaviour | Group 69: privacy panel line 'ID photo deleted after 1 month', link 'What we keep, and for how long', and 'Our team checks your ID, usually within 1–2 working days'. Group 99: on the independent route only, the fifth privacy line and the 'What happens next' wording for Didit. Group 101 (touches #360's group 99 line): the privacy panel's keep-for line matches the applied rules (20261122022323_identity_keep_for.sql) and the Privacy Policy. | Get verified side panels: those lines. Group 101: Get verified, ID step with the independent check, 'Your privacy' panel: 'Once verified: selfie and ID number kept until 90 days after you close your account; names, phone and a one-way code until 5 years after' (was 'Once verified: selfie, ID number, names and phone kept until 5 years after your account closes'). | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens); group 99 part approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 8792d583e0eb |
| `src/app/verify/continue/page.tsx` | visual | Group 69: the page a Continue on your phone QR code opens (not indexed, no referrer). | New page on the phone: see continue-capture.tsx. | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | ac9effafe882 |
| `src/app/verify/continue/continue-capture.tsx` | visual | Group 69: the phone side: opens the link once, shows 'adding ID photos for Thando D.' and the time left, takes the ID photo and the selfie with the camera, then 'All done'. Decision N: a signed-out phone signs in first (token kept in the tab, never in a URL); capture tokens when the camera starts. Review: the sign-in step shows the phone icon. | The phone page of picture 01d. Decision N: the sign-in step. | keep | approved by owner 2026-11-20 (Didit plan pictures) and 2026-11-21 (built screens) | 2026-11-20 | f1639710dab0 |

### 70. Staff operations health (item 8)

Launch checklist item 8 (roadmap M5.5, first part). The staff 'Operations
health' page (`/admin/operations`, governor and admin) read job, incident and
retention records only the retired backend had, so it was hidden (group 27).
It now reads one staff command of the live backend
(`api.get_staff_operations_health`, database update
`20261120163500_staff_operations_health.sql`), and every scheduled job records
when it last ran, so a job that stops shows as late. The page stays off
(`SHOW_STAFF_OPERATIONS`) until launch switch-on (item 60); its launch value is
on.

What the page shows once switched on (same page header, cards, tiles, table and
badges as before; only the panels' sources and words change):

- Four tiles: 'Stuck emails', 'Stuck notices', 'Payment problems', 'Blocked
  deletions' (were 'Stuck jobs', 'Failed decision updates', 'Jobs waiting',
  'Expiry job').
- 'Scheduled jobs': a table of the 17 timed jobs (for example 'Sponsored
  places', 'Partner commissions', 'Data retention', 'Emails', 'Daily refund
  check') with how often each runs, its last run ('Never' when none is
  recorded) and 'On time' or 'Late' (red). Before, a similar table sat inside
  'Evidence retention' with a 'Failures (7 days)' column, which the live
  backend does not record.
- 'Stuck emails' (with how many emails wait to send), 'Stuck notices' (privacy
  request notices the job can still send, and a grey line 'N notices from the
  last 30 days can never be sent: the request was minimised or the account's
  email address changed or is not confirmed.' when there are such notices) and 'Blocked deletions' (closed accounts whose deletion is
  held back, with the reason): new cards in the existing card style. 'Payment
  problems' lists problems of the past 7 days with an 8-character payment
  reference and a link to Payments & Refunds, and says how many paid payments
  were not activated.
- 'Evidence retention' keeps its text and its four figures; 'Open incidents'
  lists open cost alarms (metric, period, warning or critical).
- Removed: 'Failed decision updates' (the live backend applies decisions in one
  step) and 'Stuck jobs' with its 'Retry job' button (emails and notices retry
  by themselves; a stuck one is listed instead). The button's route
  (`/api/admin/ops/jobs/retry`, outside the checked scope) is removed too.
- The page shows no account names, emails, phone numbers or ids.

Pictures (synthetic data, desktop and phone, before and after) are kept
privately for the owner.

Decision: approved by owner 2026-11-21 (owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/operations/retry-job-button.tsx` | wording-behaviour | Group 70: the 'Retry job' button retried a retired-backend job; the live backend has no such job, and emails and notices retry by themselves. Removed with its route. | Nothing today (page off). Once on: no 'Retry job' button; stuck emails and notices are listed instead. | keep | approved by owner 2026-11-21 | 2026-11-20 | deleted |
| `src/app/admin/operations/page.test.tsx` | test | Group 70: the page test: needs audit:view, leads to the staff home while switched off, lists every scheduled job, shows late jobs and each kind of stuck work, sends staff to verify their authenticator again, and never claims all is well when the read fails. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 | 2026-11-20 | b2f0951e425c |

### 71. Invite-only sign-up: clearer, kinder message (item 11)

Launch checklist item 11, the invite-only sign-up message (the sign-up mode is
held in the database since item 7, group 63). While sign-up is by invitation,
everyone who signs up gets the same answer whether or not their address was
invited, so the words never say who is invited.

- After 'Create account' the page goes straight to the sign-in page. Its
  'Check your email' box says:

  > VerifyMzansi is open by invitation for now. If this email was invited,
  > we've sent it a confirmation link. Nothing there after a few minutes?
  > Resend it, or sign up with the email address your invitation was sent to.

  The box keeps its 'Resend confirmation' button.

  Before: a green 'Check your email' message on the way ('Registration is by
  invitation only for now. If this email was invited, check your inbox to
  continue.') and nearly the same words again in the box ('Registration is
  by invitation only for now. If your email was invited, we've sent it a
  confirmation link.'). The green message is no longer shown while sign-up is
  by invitation, so the words appear once, in the box. An open sign-up keeps
  its 'Account created!' message.
- A Google sign-up without an invitation, back on the sign-in page:
  'Sign-up is by invitation for now' and 'If you were invited, use the email
  address the invitation was sent to. Already have an account? Sign in with
  the email you used.', in the site's plain (white) message style, as for
  'Google sign-in was not completed', instead of the red error style. Before:
  'Registration is not open yet' and 'VerifyMzansi is open by invitation only
  for now. If you already have an account, sign in with the email you used.'
  in red.

Text outside the checked scope: the server's reply in
`src/lib/foundation/registration-message.ts`, and the choice of message after
'Create account' in `src/lib/auth/registration-outcome.ts`. Pictures (desktop
and phone, made-up data):
`docs/engineering-review/screenshots/item11-invite-message/` (not published;
the current set starts with '02-', and the 'Check your email' box with
'03-check-your-email').

Decision: approved by owner 2026-11-21 (owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

### 72. Staff: an expired authenticator check on an action goes to the two-step page

Follow-up M1 of the member-invitations review. Staff need an authenticator
check in the last 12 hours (15 minutes for sensitive actions). Opening a staff
page after it has run out already goes to the two-step page and back. A staff
action (a button or form that writes) instead got a plain refusal from the
sign-in gate, and most staff screens showed it as an error.

- The sign-in gate's refusal for staff actions now carries the same answer as
  the staff API check ('Verify with your authenticator app to continue.', with
  the two-step page's address).
- Every staff page: when an action is refused for this reason, the page goes
  to 'Two-step verification' (or 'Confirm it's you' for a sensitive action)
  and, after the code, back to the same page. Screens that already did this
  are unchanged. Other refusals still show as before. Several refusals at
  once move the page once; it only acts on staff pages, and the address it
  goes to is rebuilt as the two-step page (with 'Confirm it's you' when
  asked), never taken as given.
- 'Two-step verification' page: an address with a repeated return path no
  longer breaks the page; it returns to the staff home.
- Member invitations (group 65): a malformed request no longer says 'Enter a
  valid email address.' unless the address was the problem ('This request
  could not be read. Reload the page and try again.'); an address with a
  control character gets 'Enter a valid email address.' instead of the
  general 'could not be confirmed' message. Server answers only: no page file
  changes for these two.

Decision: approved by owner 2026-11-21 (owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/admin/staff-two-step-return.tsx` | wording-behaviour | Group 72: on staff pages, a staff action refused because the authenticator check ran out goes to the two-step page and back, as staff pages already do. | Staff: the two-step page instead of an error after an expired check. | keep | approved by owner 2026-11-21 | 2026-11-20 | e9e3dd7775fc |
| `src/components/admin/staff-two-step-return.test.tsx` | test | Group 72: checks which answers go to the two-step page, that only the two-step page is followed, that the screen still gets its answer and that the original fetch is put back. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 | 2026-11-20 | 1396865e7488 |
| `src/app/staff/two-step/page.tsx` | wording-behaviour | Group 72: the return path comes from a tested helper (staffReturnPath); a repeated `next` in the address now returns to the staff home instead of breaking the page. | Staff: nothing in normal use; a malformed two-step address opens the page instead of an error. | keep | approved by owner 2026-11-21 | 2026-11-20 | b4565266495f |

### 73. Create a post: the verification read checks the account (no file rows of its own)

A review follow-up (no change on screen). When a member's verification was
sent back, 'Create a post' reads the decision to tell 'under review', 'turned
down' and 'sent back to fix' apart (group 68). That read now also checks the
decision is about the signed-in account; an answer about any other account is
treated like a failed read ('Finish verification to start posting.', and the
browser asks again), as the dashboard already does. The page passes the
signed-in account to the read; its test signs in with a full account.

Decision: approved by owner 2026-11-21 (owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

### 74. Old backend retired: last unowned reads

The last old-backend table calls that no other checklist item covers are
removed. None changes what anyone sees.

- My profile (`/dashboard/profile`): the profile and verification steps were
  read with old table-style calls that the browser client already translated
  into the live backend's own-account read. The page now calls those reads by
  name. Same data, same screen.
- Enquiry form on post and business pages: the name it fills in for a
  signed-in member comes from the same own-profile read, called by name.
- `use-kyc-status`: deleted. No screen used it.

Before and after pictures of both screens (synthetic test data, on a phone
and a desktop) are identical.

Decision: approved by owner 2026-11-21 (owner question: 'Approve the screens (groups 69–74) and apply both database updates?'; answer: 'Yes, all of it').

### 75. Old backend retired: Complete profile read (item 10)

'Verify your phone number' (`/dashboard/complete-profile`) read the member's
profile with an old table-style call whose table name sat in a code constant,
so the old-backend counter could not see it. The browser client already
translated it into the live backend's own-account read. The page now calls
that read by name (`readRestoredOwnProfile`), the same way My profile does
since group 74. Same data, same steps: a member whose phone is verified is
still sent straight on, and a number waiting to be confirmed is still filled
in.

Pixel-identical, no visible change: before and after pictures of the page for
a member without a verified phone (synthetic test data, desktop and phone)
match pixel for pixel.

Decision: approved by owner 2026-11-21 (owner question: 'Approve the Complete profile pictures (group 75)?'; answer: 'Approve group 75').

### 76. Limits register: size limits tested at their bound

Tests only; no page changes. Each browser size check is tested at its limit
and one byte over, so the limits register can mark it proven: the profile photo
(2 MB), post photos (5 MB), the ID photo (5 MB) and the CIPC PDF (5 MB).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/business-verification/owner-verification-panel.test.tsx` | test | Group 76: a test that a 5 MB CIPC PDF is read and one byte more is refused before anything is uploaded. Group 105: tests that the Seen booking form shows from 60 days before the sticker ends, and not earlier. Group 112: a test that the 'renew by' date is shown in South African time for a browser elsewhere. | Nothing (not part of a page) | keep | awaiting owner; group 105 part approved by owner 2026-11-25 (answer: 'Approve with the rewording', the pictures with the sticker email reworded); group 112 part approved by owner 2026-11-26 (answer: 'Yes to both') | 2026-11-26 | ea0e0db6e8ec |

Decision: awaiting owner.

### 77. Authority requests (staff)

Database update 20261121043124_identity_record_disclosure (pending, apply
first). New staff pages for the commands `api.open_identity_disclosure`,
`api.read_identity_disclosure`, `api.list_identity_disclosures` and the server-only
`api.identity_disclosure_material` (capability `identity:disclose`: governors
and admins only, with an authenticator code from the last 15 minutes). Built
from the authority request pictures the owner approved on 20 November 2026
(form and record). Members see nothing new.

- Staff menu, Compliance section, under Data requests: 'Authority requests'
  with a building icon. Moderators do not see it; the page sends them to the
  staff home.
- `/admin/authority-requests`: 'Open a member's kept identity record to answer
  a police or court request. Admins and governors only. Every opening is
  logged.' A green line says how long ago the 2-step check was done and for how
  many more minutes a record can be opened; an older check sends the staff
  member to confirm it and back. '1. The request': type of request, request
  reference, reason. '2. Find the person':
  search by post link, ID number, phone number or email address, with 'Searching
  by name is not allowed.' A tick box: 'I have checked that this request is
  genuine, signed, and names this person or this post. I will keep the original
  with the company records.' 'Open record', with 'Opening the record writes your
  name, the reference and the time to the Audit log. A search that finds nobody
  is logged too.' Each refusal is shown under the form and marks its field.
  'Earlier requests': reference, disclosure number, date, who opened it, and
  Printed, Viewed only, No match found (or the result).
- `/admin/authority-requests/[id]`: the amber line 'Logged as disclosure D-0042.
  Opened by … on … for …. This record closes by itself 15 minutes after it was
  opened; opening it again is logged again.' 'Kept identity record': the
  selfie, full names as on the ID, SA ID number, verified phone (earlier numbers
  with their dates), how the ID was checked, the photo of the ID document
  (Kept or Deleted with the date) and the account. 'Print disclosure sheet', with
  the note about the sheet. No match, an account with no
  identity kept and an ID number that was only tried each get their own short
  text. After 15 minutes the page goes back to the list by itself.
- `/admin/authority-requests/[id]/sheet`: the print disclosure sheet (print or
  save as PDF; no CSV): the request, the search, who opened it and when, the
  result and the record, a diagonal 'CONFIDENTIAL · D-0042 · name · time'
  watermark, and the disclosure number, reference, staff member and time at the
  top and bottom of every printed page. 'Back to the record' and 'Print or save
  as PDF' show on screen only.

Not in the pictures: there is no 'Close record' button (a record closes by
itself after 15 minutes), and the form has no 'Who is asking' or 'Date of the
request' fields (the request type, reference and reason are kept; the opening
time is logged). 'How the ID was checked' reads 'Staff review' (automatic
checks come with a later update); 'Account' shows the account id; the 'kept
until' date waits for the retention update.

Pictures (synthetic test people only, not published):
`docs/engineering-review/screenshots/didit-pr4/` (desktop and phone).

Decision: approved by owner 2026-11-21 (owner question: 'Approve the authority-request pictures (group 77), and keep its logs while the account exists plus 5 years?'; answer: 'Approve both').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/authority-requests/page.tsx` | visual | Group 77: the new Authority requests page (governors and admins): the intro, the 2-step line and the earlier requests. | Governors and admins: the page described in group 77; a message when the list cannot be loaded. | keep | approved by owner 2026-11-21 | 2026-11-21 | ea4cd6674461 |
| `src/app/admin/authority-requests/authority-request-form.tsx` | visual | Group 77: the request form (request, search, confirmation, Open record). Group 89: only the four D9 request types; issuing court or SAPS station, official number called and who confirmed it; new tick-box words. | Governors and admins: the form described in group 77. Group 89: the form changes described in group 89. | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | e5e2bea46005 |
| `src/app/admin/authority-requests/[id]/page.tsx` | visual | Group 77: the record page (logged line, kept identity record, Print disclosure sheet). Group 89: the request type, reference, issuer and check above the record. | Governors and admins: the record described in group 77. Group 89: the request rows described in group 89. | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | 9b1de959716b |
| `src/app/admin/authority-requests/[id]/record-view.tsx` | visual | Group 77: one person's record (selfie, names, ID number, phones, how checked, ID photo, account), used on the page and the sheet. Group 89: the shared request rows; no selfie or ID photo row for an urgent request. | Governors and admins: the record rows described in group 77. Group 89: an urgent request's record without the selfie or ID photo. | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | 5c9c7e1024c6 |
| `src/app/admin/authority-requests/[id]/record-parts.tsx` | visual | Group 77: the selfie, the Print button and the 15-minute close. | Governors and admins: the selfie and the buttons described in group 77. | keep | approved by owner 2026-11-21 | 2026-11-21 | 2bf515697b20 |
| `src/app/admin/authority-requests/[id]/sheet/page.tsx` | visual | Group 77: the watermarked print disclosure sheet. Group 89: the sheet's request rows add Issued by and Checked with. | Governors and admins: the sheet described in group 77. Group 89: the request rows described in group 89. | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | 613583589e40 |
| `src/app/admin/authority-requests/page.test.tsx` | test | Group 77: checks the guard, the 2-step line, the searches (never by name), opening, refusals, the earlier requests and the re-verify redirect. Group 89: checks the four request types, the urgent wording, the new fields in the request and the official number refusal. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | c2f9f786c9ae |
| `src/app/admin/authority-requests/[id]/page.test.tsx` | test | Group 77: checks the record, no match, an ID number only tried, the closed record and the re-verify redirect, and the sheet's watermark and stamp. Group 89: checks the request rows, an urgent record without the selfie or ID photo, and an earlier record's type. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 (group 77 part) and 2026-11-22 (group 89 part) | 2026-11-22 | 5190a52cd6a5 |

### 78. Staff privacy requests: no Export on completed requests

Owner rule 2 (hide a control that no longer works). Since the privacy export
database update (pull request #331), an access request can be exported only
while it is in progress; a completed request is refused ("Only a request in
progress can be exported. Open a new access request to export again."). The
staff privacy request page still offered Export JSON on completed requests,
so the button always failed there. It is now greyed out on completed requests,
as it already was on requests that cannot be exported; in-progress requests
are unchanged. Staff only; members see nothing different.

Before and after pictures (synthetic data, desktop and phone):
`docs/engineering-review/screenshots/item62-privacy-export/`.

Decision: approved by owner 2026-11-21 (owner question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80').

### 79. Sales and VAT for staff (item 16)

Launch checklist item 16 (roadmap M8.7, remainder). Database update
`20261121090305_staff_sales_and_vat.sql` adds two reads; no table.

- Staff payments page (`/admin/payments`, `payments:view`): a new 'Sales and
  VAT' card under the page title, in the existing staff card style. Its
  description says the figures are money paid through the website in the last
  12 months, less refunds, and that sponsor fees paid outside the website are
  not included. Three
  figures: 'Last 12 months' (sales paid in the last 12 months less refunds,
  with the number of payments), 'VAT' ('Not registered', 'Registered' or 'Not
  set', with 'Alert at R1 800 000.00'), and 'Checkout drop-off, 30 days' (the
  share of online checkouts sent to Ozow in 30 days that were not paid, with 'N of M
  online checkouts paid'); a line 'Not paid: N failed · N cancelled · N expired
  · N still open'; and a table of sales by product (Individual slot,
  Multi-listing package, Add-on, Other) with the term under the product name,
  the number of payments and the amount. From R1.8 million (VAT registration is
  compulsory at R2.3 million) a red line reads 'VAT alert: sales passed
  R1 800 000.00 in the last 12 months. VAT registration is compulsory from
  R2 300 000.00: speak to the accountant.' If the figures cannot be read:
  'Sales figures could not be loaded. Reload the page.' and the payments list
  still loads.
- The daily staff payment summary email gains a 'Sales and VAT' section (the
  12-month total, and the alert line when on); with the alert on, its subject
  ends '; VAT alert'. No new email kind.
- Pricing, Billing and Trust & Safety: the 'VAT status' line reads the
  database's VAT setting instead of a fixed sentence. Today it reads 'not
  registered for VAT', as before; it is left out if the setting cannot be read
  or is not set. The Terms text used only when the published Terms cannot be
  read (`src/lib/legal/terms-text.ts`, for example a local preview without a
  database) no longer adds its own 'VAT status: ...' line; that text already
  says 'VerifyMzansi is not registered for VAT.'

Pictures (synthetic data, desktop and phone: normal, VAT alert, could not be
loaded) are kept privately for the owner.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/admin/commercial/sales-summary.tsx` | visual | Group 79: the 'Sales and VAT' card on the staff payments page. | Staff only: the card described above. | keep | approved by owner 2026-11-21 | 2026-11-21 | 2b9d77f556e9 |
| `src/components/admin/commercial/sales-summary.test.tsx` | test | Group 79: the card shows the figures, the drop-off, the table, the alert at R1.8 million, the empty state, and never figures it could not read. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 | 2026-11-21 | fb085dabc9cd |

Decision: approved by owner 2026-11-21 (owner question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80').

### 80. Partner page (item 48)

Launch checklist item 48, website only. The partner's own page
(`/dashboard/partner`) gets the design the owner approved on 14 November 2026,
built from the site's own page header, dark-green brand band, cards and
buttons. It is behind the switch `SHOW_PARTNER_PAGE`
(`src/lib/hidden-features.ts`), off in production and off at launch too
(`LAUNCH_VALUES`): the partner programme opens only once the partner agreement
is signed. While off, partners see today's page unchanged; someone who is not a
partner sees today's page either way.

The page uses only what the partner's own summary already returns
(`api.my_partner_dashboard`); no database change. What a partner sees once it
is switched on:

- Green band: 'Earned this month' (commission created this calendar month in
  South African time, including commission still in its 30-day wait, less
  reversed commission, so a refund lowers it) with 'Includes commission still
  in its 30-day wait.' always; and 'Next payout' (approved commission not yet
  paid, in gold) with 'Approved commission only.'. If the partner's latest 50
  commissions are all from this month, a second line under 'Earned this
  month' reads 'From your latest 50 commissions.' (the summary returns 50 at
  most).
- 'Share' (with the partner's status badge): the referral link, 'Code
  <code>', a filled 'Share on WhatsApp' button (opens WhatsApp with the link as
  the message) and an outlined 'Download QR code' button (a PNG picture of the
  link's QR code, black on white, so phone galleries and WhatsApp show it;
  drawn by the website's server with the same QR maker as 'Continue on your
  phone', no new dependency).
- 'Progress': 'Signed up' and 'Paying' counts.
- 'Money': 'Pending', 'Approved' and 'Paid' totals, and today's line '<rate>%
  of each qualifying payment. Commission is pending for 30 days, then approved
  if the payment stands.'.
- 'Help': 'Partner rules' (the Terms' Partners section, `/terms#partners`) and
  'Contact us' (`/contact?topic=general_support`).
- 'Recent commission': today's list, kept below the cards (not in the
  approved design, but the published Terms (posting-v5, Partners) say a
  partner sees each payment's amount and the commission it earned). It is the
  same list as today's page, moved into `partner-overview.tsx` so both pages
  draw it from one place: each commission's amount, the payment it was earned
  on, the date and its stage ('Eligible <date>' while pending).
- Today's closing line on what earns no commission is kept.

Wording to confirm (legally sensitive, kept minimal): 'Includes commission
still in its 30-day wait.', 'Approved commission only.', 'Next payout', the
rate and 30-day line (today's wording), and 'Partner rules' pointing at the
Terms.

Waits for item 50 or the partner agreement, so left out:

- 'ID-reviewed' in Progress (the summary has no such count).
- 'Customers' ('Thando D.'): not built. The published Terms (posting-v5,
  Partners) say a partner never sees a customer's name.
- Monthly statements with bank reference and PDF.
- The partner booklet (no approved text and no page yet).

Also changed, outside the checked scope: `src/lib/hidden-features.ts` and
`src/lib/launch-config.ts` (the switch, off at launch) with
`src/lib/launch-config.test.ts`; `src/lib/partners/partner-overview.ts` (the
figures, link and WhatsApp link) with its test;
`src/lib/qr-code.ts` (the QR maker, moved out of
`src/lib/foundation/capture-handoff.ts`, which now uses it unchanged) with its
test.

Pictures: the coordinator takes them (desktop 1280 px and phone 375 px).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/dashboard/partner/partner-overview.tsx` | visual | Group 80: the redesigned partner page (approved design, 14 November 2026), shown only with SHOW_PARTNER_PAGE on. Group 90: no commission percentage or 30-day figure: the Money card reads 'You earn a share of each qualifying payment. Commission is pending for a waiting period, then approved if the payment stands.' and the band 'Includes commission still in its waiting period.' (owner's decision of 22 November 2026). | Nothing today (switch off). Once on: the page described in group 80. | keep | approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-21 | c18d7b882338 |
| `src/app/dashboard/partner/partner-overview.test.tsx` | test | Group 80: the figures and the 30-day wait line, sharing links, the QR download as a PNG, help links, today's recent commission list, and no customer names. Group 90: expects the wording without a rate or waiting period in numbers. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved; group 90 part approved by owner 2026-11-22 (answer: 'Approve pictures') | 2026-11-21 | bf078984f4b8 |
| `src/app/dashboard/partner/page.test.tsx` | test | Group 80: with the switch off the page shows today's sections; someone who is not a partner sees the same page either way; with it on, the redesigned sections and today's recent commission list. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved | 2026-11-21 | e8ef6a8e85ec |

Decision: approved by owner 2026-11-21 (question: 'Approve pictures 78, 79 and 80?'; answer: 'Approve 78, 79, 80'), with the QR-as-PNG and 30-day-wait line tweaks the owner approved.

### 81. Performance page: real figures from the live backend (item 2)

The owner decided on 19 November that nothing is hidden unless it does not
work, so the owner's Performance page (`/dashboard/metrics`) must show every
section with real figures. It was hidden (M6.2) because it read statistics only
the retired backend recorded. Database update
`20261121100028_post_performance_stats.sql` records the missing ones as daily
counts per post, and the page now reads them through one owner read. The page's
layout, wording, icons and order are those of 27 October (and group 57); only
where the numbers come from changes:

- Posts (with how many are live), Views (all time, with how many were engaged:
  30 seconds of the post's video, or 90% of a shorter one), Leads (enquiries
  received) and the lead rate.
- Last 30 days: appearances in lists, detail views, WhatsApp, phone, website,
  directions, booking and ticket taps, showroom, organisation directory, search
  and home page appearances, share actions, saves (likes made in the 30 days)
  and unique viewers (one per browser per post per day); 'By post' (the 10
  busiest posts); 'Where detail views came from'.
- Showroom turns, last 7 days: each live post's turns on the home showroom and
  its area's showroom, next to the fair share.

A tourism business now shows 'Tourism & Events' under its title in 'By post'
(the restored page named the old business table, 'Mzansi Business'). The staff
Operations health page's 'Scheduled jobs' table gains one row, 'Old view records
removed' (every minute), because that clean-up is now its own job. Both pages
stay off until launch (`SHOW_OWNER_METRICS`, `SHOW_STAFF_OPERATIONS`); the
events are recorded only while `SHOW_ENGAGEMENT_TOTALS` is on. Note for the
owner: the 'Showroom turns' card says posts seen least go next and new posts get
72 hours up front; the live showroom shows the newest posts, so the fair-share
numbers will show unequal turns until the rotation is built.

Owner question: show the Performance page at launch with these figures? Also
the group 81 part of the rows for the Performance page and the staff Operations
health page. Decision: approved by owner 2026-11-21 (answering the away brief: 'everything else, I approve').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/analytics/analytics-impressions.tsx` | helper | Group 81: its comment said appearances were deduplicated on the server hourly, which was never true; it now says what happens (each card once per mount; the server counts each post once per request, within a per-network request limit). Comment only. | Nothing | keep | approved by owner 2026-11-21 | 2026-11-21 | 6c5c0efdebf5 |

### 82. Automatic ID checks: hidden until it works

No page changes. Database update 20261121094003_automatic_identity_checks
(Didit plan, build step 5) adds automatic ID checks with an admin setting that
starts at Manual (staff review the photos, as today). While it is Manual,
members and staff see nothing new: members keep the in-page camera, and staff
review every submission as before. The member and staff screens come in a
later pull request, with pictures for the owner.

Hidden until it works: the setting stays Manual until the retention update
(Didit plan C1) is applied, and the database enforces it (the command that
changes the setting refuses anything but Manual until C1 replaces it). That
update must also delete the partner's copy of
a check when staff reject or send it back, and when a member's "ask a person"
request ends without the identity being accepted. This update only deletes the
partner's copy of checks that never finished, and of automatic declines 5 days
after the decline when nobody asked a person.

Decision: hidden until it works; approved by owner 2026-11-21 (answering the away brief: 'everything else, I approve').
### 85. Business storefront (item 17b, first part)

Launch checklist item 17b, business tools plan section 1 (owner-approved 20
November 2026 with all 10 recommendations; pictures `bt-01` and `bt-02`).
Database update `20261121131915_business_storefront.sql` (pending, apply
first). Everything is behind `SHOW_BUSINESS_STOREFRONT`, off until launch
switch-on (item 60); while it is off no page changes.

Once on, only for a business that has passed the business check (a current
CIPC sticker) whose owner's Multi-listing package is running and has at least
one live listing (with none, the business page is exactly as today):

- Business page: a new 'All stock' section below the business, '18 cars'
  ('properties' when every listing is property; 'listings' for any other or
  mixed stock) beside the heading, a
  'Newest first' sort (or lowest or highest price), a search box ('Search
  Sample Motors' cars'), and filters that follow the trade: Make, Price, Year,
  Gearbox for vehicles; For sale or to rent, Area, Price, Bedrooms for
  property; Category and Price otherwise (from what most posts are). On phones the filters scroll
  sideways inside their row. Cards (2 a row on phones, 4 on desktop): photo,
  a 'Video' mark when the post has a video (never autoplay), title, price, and
  year, km and gearbox (or beds, baths and parking); the town is not repeated.
  24 at a time with 'Show more'. 'Nothing matches these filters.' with 'Clear
  filters' when a filter finds nothing.
- The 'Live offers' fact is hidden while 'All stock' shows (the one change to
  an existing part; plan section 1).
- Desktop: such a business page opens as the page itself (as in picture
  `bt-01`), not in the full-screen post viewer, which cannot show the stock.
- Post page of a listing in the storefront: the Seller card shows the
  business's logo (its initials when it has none), its name, 'Poster ID
  reviewed' and 'CIPC registered', and 'See all 18 cars' (the same words as
  the heading; to the business page's stock) instead of the member's
  short name 'Thando D.'. The desktop viewer's seller card names the business,
  shows its logo and opens its page.

Not built here (see the pull request): pinning (left out at launch),
the seller accent colour and team faces (their own pictures first; team faces
wait for package teams), staff correction of the trade, and the My slots line
'Get your business checked to switch on your storefront'.

Pictures show a business without a logo (initials tile); with a logo, the
logo takes the tile's place.

Pictures (synthetic data only, not published):
`docs/engineering-review/screenshots/item17b-storefront/` (desktop 1280 and
phone 375).

Decision: approved by owner 2026-11-21 (after seeing the storefront pictures; answer: 'No, I understand now. You can carry on with your. I approve it.').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/business/business-storefront.tsx` | visual | Group 85: the new 'All stock' section (search, filters that follow the trade, sort, cards, Show more). | Switch on, checked business with a running package: the section described in group 85. | keep | approved by owner 2026-11-21 | 2026-11-21 | df893f9c8e37 |
| `src/components/business/business-storefront.test.tsx` | test | Group 85: checks the heading, the filters per trade, a filtered read, Show more and a failed read. | Nothing (not part of a page) | keep | approved by owner 2026-11-21 | 2026-11-21 | 76827d2f86a3 |
| `src/components/business/layouts/business-layout-router.tsx` | helper | Group 85: passes 'hide Live offers' to the business layout. | Nothing by itself (see unified-layout in group 85) | keep | approved by owner 2026-11-21 | 2026-11-21 | ca150fa1b64d |
| `src/components/trust/business-stickers.tsx` | wording-behaviour | Group 85: the ID sticker's words can be set; a post's seller block says 'Poster ID reviewed' (plan notes for the build). | Only on a listing in a storefront: 'Poster ID reviewed'. Business pages keep 'ID reviewed'. | keep | approved by owner 2026-11-21 | 2026-11-21 | 42cb1b25bfab |

### 86. Copy a post (item 17b, second part)

Launch checklist item 17b, business tools plan section 3 (owner-approved 20
November 2026 with all 10 recommendations; pictures `bt-06` and `bt-07`).
Database update `20261121150309_copy_a_post.sql` (pending, apply first).
Everything is behind `SHOW_POST_COPY`, off until launch switch-on (item 60);
while it is off no page changes.

Once on, only for a member whose Multi-listing package is running:

- My posts: a 'More' button (three dots) on each Market listing, before
  Delete, with 'Copy this post'. The copy is made on the server and opens in
  the 'Post an item' form.
- The form, opened on a copy: on step 3, with the note 'Copy of "<title>".
  Everything except the video is filled in. Change what is different on each
  step. The copy waits in Drafts until you submit it; your other unfinished
  post is not touched.' The photos and logo are there; the video is not
  ('Video not copied...'). Submitting a vehicle or property copy without a new photo is refused by the server, on the photo step. Final
  check: the same-title hint while the title is unchanged, and 'Copies are
  checked like any new post and count towards your new posts allowance.'
  'Submit for review' saves and submits the copy; after a refusal it can be
  sent again. The posting-terms tick shows only when the member has not yet
  accepted the current terms (it then records the acceptance first). There is
  no 'Draft saved' line.
- My posts: a 'Drafts (N)' tab when there are unfinished copies (only
  copies), with the line 'Copies you have not sent for review yet. Each is
  deleted 14 days after your last change to it.' and on each card 'Will be
  deleted on <date>', Continue and Delete.
- Staff review (claims the reviewer holds): 'Copied from <title> (status)',
  a link only when that post is live ('a post that has since been deleted'
  once it is gone).

Differences from the approved pictures: the More menu holds only 'Copy this
post' (templates and pinning are not built; pinning is out at launch); the
fair-use line has no numbers ('100 new posts in 30 days (12 used)'); Final
check does not repeat the contact line (contacts are chosen on step 2 as
today); the video note is above today's video picker instead of a row with its
own Add button.

Change from the plan text (for the owner): the plan said a copy's photos are
stored again under new keys. Instead a copy uses the same stored photo files;
a file is deleted only when no post uses it any more, so deleting either post
never removes the other's photos (post edits already work this way). This
avoids copying files in storage. The owner is asked to confirm.

Pictures (synthetic data only, not published):
`docs/engineering-review/screenshots/item17b-copy/` (desktop 1280 and phone
375).

Decision: approved by owner 2026-11-22 (after seeing the copy-a-post pictures).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/listings/post-more-menu.tsx` | visual | Group 86: the 'More' button and its menu with 'Copy this post'; makes the copy and opens it in the form. | Switch on, running package: the button and menu described in group 86. | keep | approved by owner 2026-11-22 | 2026-11-21 | 98b3f02ffa0b |
| `src/app/post/create-listing/copy-notes.tsx` | visual | Group 86: the copy's note, the video note and the Final check lines. | Only on a copy: the texts described in group 86. | keep | approved by owner 2026-11-22 | 2026-11-21 | cad9f742c964 |
| `src/components/admin/moderation/moderation-preview-panel.test.tsx` | test | Group 86: checks the copied-from link for a live source, and no link for one that is not live or was deleted. Group 113: checks the video length line, its 'not recorded' form in a business review, and that nothing shows without lengths. | Nothing (not part of a page) | keep | approved by owner 2026-11-22; group 113 part approved by owner 2026-11-26 | 2026-11-21 | 66259467ebbd |

### 87. Post templates (item 17b, third part)

Launch checklist item 17b, business tools plan section 4 (owner-approved 20
November 2026 with all 10 recommendations; pictures `bt-08` and `bt-09`).
Database update `20261122191646_post_templates.sql` (pending, website first:
merge and deploy, then apply). `SHOW_POST_TEMPLATES` is on, like the other
switches since the owner's decision of 22 November 2026 (hide nothing before
launch). Until the update is applied the template read fails and nothing
shows; once it is applied, the following shows.

Only for a member whose Multi-listing package is running:

- Edit listing: a 'Save as template' button at the top of the form. It opens
  'Save as a template': the name, then ticks for what is kept (section and
  category; details for this category; description; location; which
  contact buttons to show, the numbers always being those of the person
  posting) and crosses for what is not (title, price, year and mileage; photos
  and video), 'You can keep up to 20.', Cancel and 'Save template'. Saving
  under an existing name replaces that template. A bottom sheet on phones.
- Create Post: 'Start from a template' with 'N of 20' above the section cards,
  only once a template exists. Each card shows the name, 'Market · <category>
  · N details', a menu (three dots) with Rename and Delete, and Use. Below the
  cards, 'Or pick a section', then today's cards unchanged.
- Use opens the 'Post an item' form filled in, with the message 'Started from
  "<name>"'; the poster adds photos, title, price, year and mileage. When the
  template replaced an unfinished post, the message says so and offers Undo,
  which brings that post back; the message stays until Undo or the first
  change in the form, and until then the template's fields are not saved over
  the earlier post (a reload brings that post back). While the template loads
  the form shows "Loading your template…"; one that cannot be read within 5
  seconds opens the saved draft instead.
- After the package ends, the templates stay on Create Post with Use turned
  off and the line 'Your Multi-listing package has ended. Renew to use
  templates.' (Renew links to My slots); Rename and Delete still work, and
  'Save as template' stays hidden.

Differences from the approved pictures: no 'Your team can use it too.' (a
template belongs to the account; package teams, item 15, do not exist); the
details line reads 'Details for this category' instead of naming vehicle
details, since templates cover every Market category; the section cards below
keep their full current design (the picture drew them small); Rename and
Delete open small dialogs, which the pictures did not draw;
'Save as template' in the My posts 'More' menu arrives with that menu (group
86).

Pictures (synthetic data only, not published):
`docs/engineering-review/screenshots/item17b-templates/` (desktop 1280 and
phone 375).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/post-templates/save-template-dialog.tsx` | visual | Group 87: the 'Save as a template' dialog (bottom sheet on phones) and its save. | Switch on: the dialog described in group 87. | keep | approved by owner 2026-11-22 | 2026-11-21 | 7b9bc1908ef4 |
| `src/components/post-templates/save-template-button.tsx` | visual | Group 87: the 'Save as template' button on a post form, shown only while the package runs. | Switch on, running package: the button described in group 87. | keep | approved by owner 2026-11-22 | 2026-11-21 | 2eb0e776281c |
| `src/components/post-templates/save-template-button.test.tsx` | test | Group 87: checks naming and saving, a refusal, and no button without a running package or with the switch off. | Nothing (not part of a page) | keep | approved by owner 2026-11-22 | 2026-11-21 | 692ad40e19d5 |
| `src/components/post-templates/template-picker.tsx` | visual | Group 87: 'Start from a template' with its cards, Use, and the Rename and Delete dialogs. Group 87 (review): Use is off and a renew line shows after the package ends. | Switch on: the section described in group 87. After the package ends: Use is off and "Your Multi-listing package has ended. Renew to use templates." shows. | keep | approved by owner 2026-11-22 | 2026-11-21 | d9df771fcd2e |
| `src/app/post/create-listing/listing-template.tsx` | visual | Group 87: reads the template (giving up after 5 seconds, then the saved draft opens), and the "Started from <name>" message with Undo when it replaced an unfinished post. Group 87 (delta review): the Undo message stays until Undo or the first edit; the loading screen while a template loads. | Switch on: the messages described in group 87. The "Started from" message with Undo no longer closes on its own; "Loading your template…" while a template loads. | keep | approved by owner 2026-11-22 | 2026-11-22 | 0b0388e90087 |

### 88. Fair showroom for every post (item 66)

Launch checklist item 66, fair showroom plan (owner-approved 21 November 2026:
'Approve all 7'; plan pictures `1` to `5` count as the design sign-off; the
built screens come back for picture sign-off). Database update
`20261122023000_fair_showroom.sql` (pending, apply first).

- Home showroom and the Market, Business and Tourism & Events showrooms: the
  cards come in the fair order instead of newest first. Posts seen least this
  week go first; of every 7 places, 3 show posts from the visitor's city, 2
  from the rest of the province and 2 from the rest of South Africa (estimated
  from the connection for that page only, never stored; an unknown area gets
  the all-South-Africa order). The front card changes among the first three on
  each visit. If the order cannot be read, the showroom shows the newest posts
  as today.
- The showroom sends each card's appearance once per page load (no visible
  change).
- A post's card in a showroom carries a gold 'New' tag (dark green text) in the
  card's existing badge spot for the first 3 days after it first went live.
- Help page 'How the showroom works', the Performance page's 'Showroom turns'
  card (still hidden) and the privacy notice: the wording of plan section 6.

Not built here (see the pull request): the New tag on search results and the
area browse lists (plan question 3), which needs the search cards to carry it.

Pictures (synthetic data only, not published):
`docs/engineering-review/screenshots/item66-fair-showroom/built/` (desktop 1280
and phone 375).

Decision: awaiting owner (built pictures).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/help/showroom/page.test.tsx` | test | Group 88: checks the help page's five rules and the fair showroom's numbers in them. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-22 | e2ce8c5d3c53 |

### 89. Authority requests: only the four D9 request types (item 69)

Launch checklist item 69, owner decision D9 of 21 November 2026 ("Keep both").
Database update `20261122013616_authority_request_types.sql` (pending, apply
first). Governors and admins only; members see nothing new. No file rows: the
group 89 part of 6 rows in group 77.

- `/admin/authority-requests`, '1. The request': 'Type of request' offers only
  'Subpoena (Criminal Procedure Act, s205)', 'Court order', 'Search warrant' and
  'Urgent: a life is at risk (SAPS, in writing)' (the written police request and
  the Information Regulator are gone). 'Request reference' becomes 'Case number
  on the court document' ('Case number on the written request' for an urgent
  request), and three new fields follow: 'Issuing court' ('SAPS station' for an
  urgent request), 'Official number you called' and 'Who confirmed it', with
  'Call the issuing court or the prosecutor named in it on an official number to
  confirm it.' (urgent: 'Call the station on its official number to confirm the
  request. Only the names, ID number and verified phone are given; never the
  selfie.'). The tick box reads 'I checked this request on the official number
  above. It is genuine and names this person or this post. I will keep the
  original with the company records.' Each missing field is refused under the
  form and marked.
- `/admin/authority-requests/[id]` and the print sheet: 'Type of request',
  'Reference', 'Issued by' and 'Checked with' (who, on which number) above the
  record (the sheet keeps its other request rows). An urgent request adds '(only
  the minimum is given; never the selfie)' to its type, and its record shows no
  selfie and no 'Photo of the ID document' row: full names, SA ID number,
  verified phone (the current number only, no earlier numbers), how the ID was
  checked and the account. Records opened before
  this change show their earlier type and no 'Issued by' or 'Checked with'.

Pictures (synthetic test people only, not published):
`screenshots/item69-authority-requests/` (before and after, desktop 1280 and
phone 375).

Decision: approved by owner 2026-11-22 (after seeing the item 69 pictures; answer: 'Approve both', for the pictures and the database update).
### 93. Free credits for businesses you recruit (item 70)

Launch checklist item 70, the owner's design of 22 November 2026. Database
update `20261122130744_free_credits.sql` (pending, apply first): commands
`api.give_free_credit`, `api.extend_free_credit` and `api.list_free_credits`
(admins; giving and extending need an authenticator code from the last 15
minutes). A gift is a slot (entitlement) with the new source `free_credit`:
never charged, never renewed, not in sales or VAT figures.

- Staff menu, Commercial section, after Payments & refunds: 'Free credits' with
  a gift icon (admins only; other roles do not see it and the page sends them
  to the staff home).
- 'Give free credits': the member's email, Posts (1 to 6, default 1), Days (1
  to 30, default 30), a Reason (5 to 200 characters) and Give. On success:
  'Gave 1 post until 22 Dec 2026.' and the new row is highlighted. Refusals in
  plain words: no active account with that email, ID review not accepted yet,
  the admin's own account or another account of theirs ('House slots cover
  that'), an admin without an accepted ID review of their own, a member who
  already has free credits running ('Use Extend on that gift instead'), not an
  admin, a bad number or reason. A stale authenticator code sends the admin to verify again
  and back. Nobody is emailed.
- 'Gifts', newest first (up to 500): the masked email ('t***@example.co.za',
  'Closed account' after erasure), Active or Ended, '1 post · until 22 Dec 2026
  · 42 views' (all-time views of the posts the gift carried). 'Extend' opens a
  dialog: Days (default 30) and a Reason; it says whether days are added after
  the current end or from today. No Extend for a closed account.
- Members: My slots shows the gift as 'Free credits from VerifyMzansi: 1 post'
  with 'Ends <date>', days left and its posts, without Renew; the posting slots
  card on My posts names it 'Free credits from VerifyMzansi' with 'Never
  charged · All sections'. The usual slot renewal reminder does not cover
  gifts (it covers paid slots only), so no end reminder is sent.

Pictures (synthetic data, local preview, not published):
`screenshots/item70-free-credits/` (desktop 1280 and phone 375): the give
form, the list, the extend dialog and the member's My slots card.

Decision: awaiting owner.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/free-credits/page.tsx` | visual | Group 93: the new Free credits page (admins only): reads the gifts through the foundation command. | Admins: the page header and a message when the list cannot be loaded. | keep | awaiting owner | 2026-11-22 | 8d4d79fa6c30 |
| `src/app/admin/free-credits/free-credits-client.tsx` | visual | Group 93: the give form, its messages, the gifts list and the extend dialog. | Admins: everything described in group 93. | keep | awaiting owner | 2026-11-22 | 76345630e36e |
| `src/app/admin/free-credits/free-credits-client.test.tsx` | test | Group 93: checks the list, the empty state, giving with defaults and chosen values, refusals, the re-verify redirect and extending. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-22 | 3588d3f27504 |
| `src/app/admin/free-credits/page.test.tsx` | test | Group 93: checks the page guard, the header, the re-verify redirect and the failed-read message. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-22 | a3e1c1158591 |
| `src/components/dashboard/slot-usage-card.test.tsx` | test | Group 93: checks the free credits line on the posting slots card. | Nothing (not part of a page) | keep | awaiting owner | 2026-11-22 | 1dc4434888fb |

### 90. Hide nothing before launch: every feature switch on (item 71)

Launch checklist item 71, owner decision of 22 November 2026: hide nothing
while the site is pre-launch (sign-up is invite only, and the owner checks every
function before inviting anyone), with no "coming soon" wording. No file rows of its
own: the switches live in `src/lib/hidden-features.ts` and `src/lib/constants/pricing.ts`
(`PACKAGES_ON_SALE`), outside the frozen scope; no screen is redesigned, each one
shows the version the owner approved in its own group. The group 90 part of 11
test rows elsewhere: unit tests that check a switch's off branch pin it off,
and the staff menu, staff home, member sidebar and Multi-listing page tests
expect what production now serves.

These compile-time switches are now `true` in production: SHOW_ENGAGEMENT_TOTALS
(group 61), SHOW_OWNER_METRICS (group 81), SHOW_LOCATION_DETECTION (group 58),
SHOW_STAFF_OPERATIONS (group 70), SHOW_ACCOUNT_DELETION (group 43),
SHOW_PAID_ADDONS, SHOW_SPONSOR_OFFER, SHOW_PARTNER_PAGE (group 80; on by the
owner's new decision, although the partner agreement is not signed yet),
SHOW_BUSINESS_STOREFRONT (group 85), SHOW_POST_COPY (group 86) and
PACKAGES_ON_SALE (group 60). SHOW_ORGANISATION_REPORT and SHOW_PACKAGE_TEAMS
stay off (see below). The pre-launch pop-up is unchanged: it stays until
sign-up opens. Database switches (such as the packages sales switch and add-on
sales, a website setting) are unchanged, so some buttons on these pages cannot
complete yet; the pull request lists them.

Owner's wording decisions of 22 November 2026 (relayed by the coordinator):
no named municipality or organisation is presented as a partner or sponsor
(the code names none: the one such line, on Business Sponsors, was removed in
group 52; sponsors listed from the database are data, not code); the partner
page states no commission percentage or waiting period in numbers (the group 90
part of the two partner page rows and their test row: 'A share of each
qualifying payment. Commission is pending for a waiting period, then approved if
the payment stands.'), while each partner's own amounts stay; all package,
sponsor and add-on prices stay as they are.

After the independent review (coordinator's fix round): no visible link leads
to a 404 (the Multi-listing page and the package checkout are always shown;
while packages are not on sale, paying is refused and asking for an invoice
says 'Multi-listing packages are not on sale yet.'); 'See … prices' on
Advertise only for Individual; Business Sponsors says 'No sponsors yet' when
none is listed; SHOW_ORGANISATION_REPORT (item 46) and SHOW_PACKAGE_TEAMS
(item 15) stay off because what they show is not built.

Pictures: the refreshed visual baselines and the screenshots on the pull
request.

Decision: approved by owner 2026-11-22 (owner question: the 7 pictures on the pull request; answer: 'Approve pictures').

### 91. Email before a long paid term ends (item 68b)

Email only: no file in the checked scope changes, so this group has no file
rows. Launch checklist item 68b (Consumer Protection Act s14(2)(c); owner's
answer: terms of 180 days or more get a written notice about 60 business days
before the end, and nothing renews automatically). Database update
`20261122111209_term_ending_notice.sql` (pending, apply first) queues one email
per paid term of 180 days or more, 63 to 84 days before it ends (about 60
business days). The words are new (owner rule 4). Text outside the checked
scope: `src/lib/services/email.ts` (`term_ending_notice`, `TERM_ENDING_BODY`).

Subject: 'Your paid term is ending'.

An Individual slot of 180 days:

> Your Individual slot ends on 14 February 2027 at 12:00 (South African time).
> Nothing renews automatically and you will not be charged again.
>
> To keep posting after that date, renew this slot from My slots from 14 days
> before it ends (the new days start when the current ones end), or buy a new
> slot on Billing. If you do nothing, the slot simply ends: its post is hidden
> then and deleted 3 days later, with its photos and videos.

Button 'See my slots' (to `/dashboard/slots`).

An Individual slot whose owner's Multi-listing package runs past the slot's
end (renewing and buying a slot are closed while it runs; its post moves into
the package when the slot ends if the package has a free place then, and is
otherwise hidden and deleted 3 days later): the same first paragraph, then
only:

> Its post then moves into your Multi-listing package if the package has a free
> place on that date. If it has none, the post is hidden then and deleted 3 days
> later, so keep a place free or add one from My slots.

Button 'See my slots' (to `/dashboard/slots`).

A Multi-listing package of 180 days ('Your Multi-listing package ends on ...')
or any other paid plan ('Your paid plan ends on ...'), same first paragraph,
then:

> To keep posting after that date, buy again on Billing. If you do nothing, it
> simply ends: the posts it pays for are hidden then, unless another of your
> slots takes them, and deleted 3 days later, with their photos and videos.

Button 'Go to Billing' (to `/billing`).

A banned or suspended member (who cannot sign in) gets the same first
paragraph, then only (whatever the term):

> You do not need to do anything.

with no button and no link. The email is not sent without its end date. The
footer line stays 'This is an operational update about your VerifyMzansi
account.' No bell notice is added.

Decision: awaiting owner.

### 92. Registered street address no longer shown

The owner decided that the company's registered street address is never shown
on any page. Until now Trust & Safety, the Terms and the PAIA page listed a
'Registered address' row with the street address among the company details.
That row, its setting and its built-in value are removed
(`src/lib/trust-public-config.ts`, outside the frozen folders, so no file rows).
Every other company detail row stays as it is. A wider change still in review
(the legal must-haves pull request) makes the same removal; this group ships it
first.

Pictures (not published): `screenshots/hide-address/` (desktop 1280 and phone
375, before and after; the address is blurred in the before pictures).

Decision: approved by owner 2026-11-22 (answer: 'Approve').

### 94. Email before a free credit ends (item 70b)

Email only: no file in the checked scope changes, so this group has no file
rows. Launch checklist item 70b. Database update
`20261122182304_free_credit_reminder.sql` (pending, apply first) queues one
email 3 days before a free credit (group 93) ends, once per end: a gift extended
after its email gets a new one 3 days before its new end. Nothing is sent for a
gift ended early, or to a member who is banned, suspended or closed. The words
are new (owner rule 4). Text outside the checked scope:
`src/lib/services/email.ts` (`free_credit_reminder`,
`FREE_CREDIT_REMINDER_BODY`).

Subject: 'Your free credits end soon'.

> Your free credits from VerifyMzansi end on 20 December 2026 at 12:00 (South
> African time).
>
> The posts they cover are then hidden. Unless you reactivate them in another
> slot, they are deleted 3 days later, with their photos and videos.

Button 'See my slots' (to `/dashboard/slots`, where the gift is listed). The
email is not sent without its end date. No renewal, purchase or further gift
is offered. The footer line stays 'This is an operational update about your
VerifyMzansi account.' No bell notice is added.

Picture (synthetic data, not published): `screenshots/item70b-reminder/`.

Decision: approved by owner 2026-11-23 (answer: 'Yes, approve both'), with
'cover' in place of 'pay for'.

### 95. Terms posting-v6: the package rules (item 27)

Launch checklist item 27. The Terms page (`/terms`) reads the current Terms
from the database, so its text changes when database update
`20261123225900_posting_terms_v6.sql` (pending, website-first) makes posting-v6
current. The text is outside the checked scope
(`src/lib/legal/terms-documents/posting-v6.json`; `src/lib/legal/terms-text.ts`
shows it when the database cannot be read). `src/app/terms/page.tsx` (row
elsewhere) loses the 'Reporting a post' section that group 96 added, so the
reporting rules appear once. The page's layout and its other sections are
unchanged. The words are new (owner rule 4).

What visitors see on `/terms`:

- A new section after 'Slots & prices': 'Multi-listing packages' (5 to 250
  slots at R100 per slot per 30 days for 30, 90 or 180 days, all ending
  together; fair use across the package; one package per account after the ID
  review; Individual slots while a package runs; adding slots online or by
  invoice; no renewal; posts when a package ends; no transfers). Paid add-ons
  are not offered and are not in the Terms.
- Changed paragraphs: a package example and the email before a term of 180
  days or more ends, under 'Slots & prices'; packages above 100 slots paid by
  invoice at the same price, and no interest or late fee, under 'Paying, VAT &
  invoices'; cancelling a package, the first purchase refundable within 5
  business days, refunds to the original method or an account in the member's
  own name, and lost days after an overturned suspension, under 'Refunds &
  cancelling'; the children rule and licence numbers under 'Account posting
  obligations'; two more prohibited kinds, restricted goods, how to report a
  post (Report, or abuse@verifymzansi.com with the post's link, what is wrong
  and how to contact you; action within 2 business days; every report
  recorded), and removal of a post and restriction of its account on a
  credible complaint, under 'Prohibited content'; the content licence under
  'Promotion & distribution rights'.
- Also changed: the free post line under 'Free first post & visibility' no
  longer lists boost, featured placement or an urgent badge ('standard placement
  only, with no automatic charge or free renewal'), and while slots are not on
  sale, checkout (not the pricing page) says so.

The posting tick on the create forms is unchanged ('I accept the VerifyMzansi
posting terms, ...'). After the switch every member ticks it once more before
their next submission or edit, as after earlier Terms changes.

The edit forms (rows elsewhere: `src/app/post/edit-listing/[id]/page.tsx`,
`edit-business`, `edit-tourism` and their tests): until now they had no tick,
so after a Terms switch an edit was refused ('Review and accept the current
posting terms...') with nowhere to accept. While the member has not accepted the
current terms, each edit form now shows the same tick as Create listing, just
above Save changes. Saving without it shows 'Accept the posting terms before
submitting.'; with it, the terms are accepted and then the changes are saved.
Members who already accepted see no change. The tick is one shared component
(below), also used by Create listing with the same markup and words.

The dashboard's Resubmit and other post buttons still only show the refusal
text when the terms are not accepted; the member accepts them by opening Edit
on the post (or creating a post).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/post/posting-terms-consent.tsx` | helper | Group 95: the posting-terms tick, shared by Create listing and the three edit forms. Group 115: one tick for every form: what is posted and the area colours are options (post in green by default, business post in blue, tourism or event post in teal). | Nothing by itself (see the forms' rows): the same box, words and 'View terms' link as Create listing's tick. Group 115: Nothing (each form looks as before) | keep | approved by owner 2026-11-24 (answer: 'Yes, approve both'); group 115 part approved by owner 2026-11-26 | 2026-11-26 | 7b8003f14135 |

The 'Reporting a post' section after 'Who we are' and its navigation link are
removed from `/terms`; its rules are now part of the Terms text, once, under
'Prohibited content', with group 96's wording about what to include in an
email. Until database update `20261123225900_posting_terms_v6.sql` is applied
straight after the release, the page shows posting-v5, which has no reporting
paragraph.

Pictures (synthetic data, not published): still to be taken on the local test
copy for `screenshots/item27-terms-v6/` (the Terms page and the posting tick,
phone 375 and desktop 1280).

Decision: approved by owner 2026-11-24 (answer: 'Yes, approve both').

### 96. Legal must-haves before sales open (item 68)

Launch checklist item 68 (ECTA s43, takedown, complaints, CPA s26 invoices,
PAIA manual). Text added in the existing style; no page is redesigned. The
business facts (director, dispute-resolution code, Deputy Information Officer,
postal address) are the owner's answers of 22 November 2026. No page prints a
street address: the registered address is named as recorded at CIPC, and the
'Registered address' row with the street address is removed from Terms, the
PAIA manual and Trust & Safety (the owner's instruction).

- Terms: 'Who we are' gains the ECTA s43 rows; new 'Reporting a post' section;
  'keep a copy' and security lines under 'Privacy & contact'.
- The owner's tidy-ups of 23 November 2026: on Terms and the PAIA manual the
  owner's name is shown once, in one row 'Director and Information Officer'
  (was 'Responsible officer', 'Information Officer' and, on Terms,
  'Directors'); the registration number is no longer repeated in the
  registered address note; legal notices go to legal@verifymzansi.com.
- Trust & Safety (no file change): the 'Registered address' row is gone from
  its company details.
- Contact: a new 'Complaints' card in the right column (support email with
  'Complaint' in the subject, reply within 10 business days, the National
  Consumer Commission for escalation).
- PAIA manual: the template's missing sections (contact details, abbreviations,
  updates, availability, named transfer countries).
- Checkouts (slots, package, add slots): 'Terms · Refunds' after the consent
  text. The checkout already is the review step before paying ('Review before
  you pay': what is bought, price, days, start and end, consent, Pay, Back).
- Invoice: 'Total before VAT' and 'VAT None' rows above the total.
- Emails (not a page): every email's footer names VERIFYMZANSI (PTY) LTD and
  its registration number; the receipt's text version too.

Pictures (synthetic data only, not published): `screenshots/item68-legal/`
(desktop 1280 and phone 375, before and after).

Decision: approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'), with the owner's name shown once and legal notices to legal@.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/contact/page.tsx` | wording-behaviour | Group 96: the complaints line (settled legal answer E9). | Contact: a 'Complaints' card under 'Prefer email?': 'Email support@verifymzansi.com with 'Complaint' in the subject. We reply within 10 business days. If we can't resolve it, you can take it to the National Consumer Commission.' | keep | approved by owner 2026-11-23 (answer: 'Approve with tidy-ups') | 2026-11-22 | ecd585163fce |
| `src/components/billing/checkout-terms-links.tsx` | helper | Group 96: the 'Terms · Refunds' links after a checkout's consent box, shared by the three checkouts. Group 114: adds 'No VAT is charged.' under a checkout's total (decision C3: not registered for VAT), shared by the three checkouts. | Nothing by itself (see the checkouts in group 96) Group 114: Nothing by itself (see the checkouts in group 114) | keep | approved by owner 2026-11-23 (answer: 'Approve with tidy-ups'); group 114 part approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 76cf914e33a3 |

### 97. Test fix: no delayed redirect after My profile unmounts (item 76)

Tests only; no page changes. Launch checklist item 76 (two flaky CI tests).
After an account is closed, My profile waits 1.5 seconds and then does a full
page load. If the page had already gone (in the unit tests: torn down at the end
of a test), that delayed load could still run and fail the test run. It is now
dropped when the page unmounts. The redirect a member sees is unchanged. File
rows: the group 97 part of the `src/app/dashboard/profile/page.tsx` and
`page.test.tsx` rows in earlier groups. The second flaky test (phone numbers in
the database limit test fixtures) is outside the checked scope.

Decision: awaiting owner.

### 98. Remove paid add-ons (item 37)

Launch checklist item 37. The owner decided on 24 November 2026: 'Remove all
three'. The paid add-ons Urgent, Boost and Featured were never delivered and
never sold (every add-on checkout was refused). Everything visitors and members
could see of them is removed; nothing new is added.

- Advertise: the 'Get more eyes on a post' section (Urgent R10, Boost R15,
  Featured R25, each for 7 days) is gone.
- Plan cards (pricing page, billing, the posting plan box and the business
  'Post' package dialog): the 'Urgent label add-on' line is gone.
- Billing FAQ: the free post answer no longer says 'Free posts have standard
  placement: no boosts, featured placement or urgent badge.'
- How the showroom works: the first rule always reads 'Free or paid, every
  live post gets an equal turn at the front of the showroom. The posts that
  have been seen least this week go next.' The rule 'a post with a video gets a
  small boost within its turn' stays (not an add-on).
- My posts: the round Urgent, Boost and Featured buttons ('Promote this post')
  are gone from each post, so More and Delete now follow the other buttons
  instead of sitting on the right; the line under the heading reads 'Edit or
  take posts offline.' (was 'Edit, promote or take posts offline.'). The
  business 'Post' package dialog loses its 'Boost level' column and the words
  'and boost tools'.
- Staff activity feed: the five add-on purchase labels are gone (never
  recorded).
- The 'Add-ons open soon. You have not been charged.' reply is gone with the
  add-on checkout routes.

Rows: six below, plus the group 98 part of 10 rows elsewhere (Advertise and its
test, How the showroom works, My posts and its test, plan cards, posting plan
box, billing FAQ, Boost button, activity feed). The database still holds its
add-on commands, products and staff payment fields; removing them is a later
database step.

Pictures (synthetic data, not published): `screenshots/item37-remove-addons/`
(desktop and phone).

Decision: approved by owner 2026-11-25 (answer: 'Approve them').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/listings/addon-checkout-button.tsx` | wording-behaviour | Group 98: the shared add-on checkout button is removed with the paid add-ons (item 37). | My posts: no Urgent, Boost or Featured button. | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | deleted |
| `src/components/listings/featured-button.tsx` | wording-behaviour | Group 98: removed with the paid add-ons (item 37). | My posts: no Featured button. | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | deleted |
| `src/components/listings/urgent-button.tsx` | wording-behaviour | Group 98: removed with the paid add-ons (item 37). | My posts: no Urgent button. | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | deleted |
| `src/components/listings/post-account-button.tsx` | wording-behaviour | Group 98: the 'Boost level' column described add-on placement; it is removed with the paid add-ons (item 37). | My posts, a business's 'Post' package dialog: no 'Boost level' column; the line reads 'Your account gets posting capacity based on the package you choose.' (no 'and boost tools'). | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 36387ab9a0c6 |
| `src/hooks/use-entitlements.ts` | rewiring | Group 98: no add-on flags (canBoost, canFeature) now that paid add-ons are removed. | Nothing (same look and steps) | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 7706b4b4e9a8 |
| `src/hooks/use-entitlements.test.ts` | test | Group 98: no add-on flags in the expected entitlements. | Nothing (not part of a page) | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-24 | 1df72337d820 |

### 99. Automatic ID checks: member and staff screens (item 61, part 7)

Launch checklist item 61, part 7 (Didit plan, build step 7). Website only; no
database change. The plan pictures (version 3) were approved on 20 November
2026; these are the built screens. Nothing changes while the staff setting is
Manual, which is today's value: the database answers "manual" and the ID step
stays the in-page camera route exactly as now. The setting stays Manual until
the member's consent is recorded in the database (item 61, part 7a), the
privacy notice (item 41) and the privacy export follow-up are done.

Member side, Get verified, ID step, on a Didit setting:

- Start (picture 02): the name fields; 'Our independent verification system
  will ask you to' photograph the ID and record a short selfie video; 'Your
  data' (runs inside this page, receives no name, email or phone number,
  deletes its copy of the ID photo after 1 month); the consent tick 'I agree
  that VerifyMzansi asks Didit, our independent verification partner, to check
  my ID and my face, as described in the privacy policy, Didit's Verification
  Privacy Notice and its End User Terms' with the three links; Back and Start
  ID check (disabled until the tick and both names). No ID number field and no
  camera on this route: the check reads the ID.
- The check inside the page (02b), then 'Checking your ID' (03) once the
  check says it finished; the page asks for the result every 15 seconds while
  it waits.
- Verified (04) with the full name and the buyer name, and 'Continue to
  location'; 'A person will check your ID' (05) with 'Meanwhile, add your
  location'.
- Fully automatic decline (06): what went wrong in plain words with a tip,
  'Try the ID check again' and 'Think we got it wrong?' with 'Ask a person to
  look again (ask by 25 November)'. Asking opens a short form in the step
  (07): what a person does, a note, the deletion promise, 'Send to a person'.
- Paused or over the spending limit (08): the camera route with 'The automatic
  check isn't available right now. Take your photos here and one of our team
  will check them.'
- Side panels: 'What happens next' item 2 and a fifth privacy line ('Once
  verified: selfie, ID number, names and phone kept until 5 years after your
  account closes'), only on the independent route.
- Every setting: until the step's route is known, the ID step shows a short
  'Loading the ID step…' line instead of the camera form (on Manual the
  camera form then appears as today). A failed later read keeps the last
  answer.
- After an in-app link to Get verified, the page loads itself once more
  before the check can start or an unfinished one is shown (the check's frame
  is only allowed on a full load of the page); members see the loading line
  for that moment.

Staff side:

- Verify accounts: an 'ID checks' card above the queue (09, 10): Manual /
  Didit, staff have the final say / Didit fully automatic, a reason and Save
  setting. The two Didit settings are shown but disabled, with 'The two Didit
  settings switch on once consent recording is live.', and the route refuses
  them until then (part 7a). Every staff member sees it; only admins can change it (the database
  also needs their authenticator code from the last 15 minutes and sends them
  to verify again). 'Didit working' with the last 7 days' counts, or the pause
  with 'Resume Didit checks', and the latest 5 changes with their reasons.
- The review case view (View documents): a 'Didit check' panel with the
  result, why it did not pass, the names the member typed and the member's
  'ask a person' note.

Differences from the approved pictures:

- Decision L (20 November 2026, later than the pictures): the consent step
  names Didit and links its two notices (picture 02 named no provider).
- 06: 'You can try the ID check up to 3 times in 7 days' instead of the tries
  left this week (the website does not get that count).
- 07: the form opens inside the ID step, not as a page under 'Decisions and
  appeals', and the note needs at least 20 characters (the database requires
  it); picture 07 said the note was optional.
- 'What happens next' says 'If anything is unclear, our team checks it' for
  both Didit settings (the member's page does not know which one is on); after
  a decline it says 'you can ask a person to look again'.
- The page heading's line and status pill stay as today on every state.
- 09/10: the Manual card says 'Members take photos with the in-page camera'
  (no uploads since the camera-only change); the pause shows 'until' its end
  time rather than 'since'; 'Every change is logged with its reason' with the
  latest 5 changes on the card, instead of 'Every change shows in the Audit
  log' (the audit log page does not list these changes).
- 11: no Didit chips on the queue rows yet: the queue read does not carry the
  check status. Part 7a adds it, then a small change adds the chips. The 'Place
  fraud hold' reminder next to Reject is not part of this change.

Pictures (synthetic data only, not published): `screenshots/item61-didit-screens/`.

Decision: approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/verification/independent-check.tsx` | visual | Group 99: the independent check's states on the ID step (start with consent, the check in the page, checking, verified, a person will check, decline with try again and ask a person, the paused line). Group 101 (touches #360's group 99 consent step): the consent names where Didit handles the data (settled legal answer D3), as the Privacy Policy's Didit entry does. | Get verified, ID step, only on a Didit setting: pictures 02 to 08 as built. Group 101: Get verified, ID step, the consent tick reads '... to check my ID and my face, with my data held in Ireland (European Union) and some of Didit's providers in the United States, as described in the privacy policy, Didit's Verification Privacy Notice and its End User Terms.' (both links kept). | keep | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures); group 101 part approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | 451b17677a8e |
| `src/app/admin/verification/identity-check-settings-card.tsx` | visual | Group 99: the three-way ID check setting. | Staff only: the 'ID checks' card on Verify accounts. | keep | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures) | 2026-11-25 | 0f19b39bab1f |
| `src/app/admin/verification/identity-check-settings-card.test.tsx` | test | Group 99: read-only for non-admins, save with a reason, verify again on a stale 2-step check, resume a pause. | Nothing | keep | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures) | 2026-11-25 | 771f2d1a6105 |
| `src/components/admin/identity-check-panel.tsx` | visual | Group 99: the case's latest Didit check in the case view. | Staff only: the 'Didit check' panel in View documents. | keep | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures) | 2026-11-25 | 89b5d6f24fac |
| `src/components/admin/identity-check-panel.test.tsx` | test | Group 99: the panel's result, reasons, names and request. | Nothing | keep | approved by owner 2026-11-25 (answers: 'Approve them' for the main screens, 'Approve both' for the loading and staff-setting pictures) | 2026-11-25 | 1ae33c9837a5 |

### 101. Trust promise matches reality (item 41)

Launch checklist item 41, with the settled legal answers D3 (every country
named), D4 (every POPIA section 18 item), D5 (the notice part), D7 and D11.
The words now match what the system does; nothing new is offered.

- Privacy Policy: 'Who we are' (registered name and number, the registered
  address as recorded at CIPC, legal notices by email; no street, no owner
  name); 'Cookies and browser storage'; where information comes from, what is
  voluntary or needed and why tax law needs payment records; how IDs are
  checked (staff or Didit, consent first, 5 days to ask a person); keep-for
  periods as the applied database rules run them; the Regulator's eServices
  portal; every provider and country; screen replays are not recorded; number
  taps are limited, not logged.
- PAIA: the same recipients (Didit, Zoho and Google added; files are with
  Cloudflare, not Supabase; Ozow as a recipient).
- Trust & Safety, Advertise and the business verification help: the ID check
  wording no longer says only 'our team', because Didit may check IDs.
- The posting plan box and the dashboard trial card lose branches for a 30-day
  or account free post that the backend never offers (no visible change).
- The positioning statement, softened at the owner's request ('Soften it', 25
  November 2026): 'VerifyMzansi is a trusted South African platform connecting
  people with businesses, products, services, tourism and events from
  ID-reviewed posters. Discover, connect and do business with confidence.' Home
  (about section), the footer (short form, 'What we check' link kept) and the
  site's search description use it; it was 'verified businesses, products, ...'.
- Not a frontend file: the website no longer sets an unused, unsigned
  view-and-like cookie on the first page load (the notice says the identifier
  comes only after a Turnstile check), and the ID reviewed email says 'We have
  reviewed' instead of 'Our team has reviewed'.

- Get verified, ID step with the independent check (files from #360, group
  99): the 'Your privacy' line reads 'Once verified: selfie and ID number kept
  until 90 days after you close your account; names, phone and a one-way code
  until 5 years after' (was '... kept until 5 years after your account closes'), and
  the consent tick adds 'with my data held in Ireland (European Union) and some
  of Didit's providers in the United States' (both links kept).

Rows: none of its own; the group 101 part of 12 rows elsewhere (Advertise,
business verification help, PAIA, Privacy Policy, Trust & Safety, posting plan
box, dashboard trial card, Home about section, footer, verification privacy
panel, independent check consent, verification page test).

Pictures (synthetic data, not published): `screenshots/item41-trust-promise/`
(desktop and phone).

Decision: approved by owner 2026-11-25 (answer: 'Approve them').

### 100. Add lost days (item 75)

Launch checklist item 75. The posting terms (posting-v6) promise that when we
fail to provide what a member paid for, or a suspension is overturned, we first
add the days they lost, and that a package's slots still end together. Database
update `20261125113433_add_lost_days.sql` (pending, apply first): commands
`api.get_lost_days_preview` (payments:view) and `api.add_lost_days`
(payments:refund, an authenticator code from the last 15 minutes). Owner
decisions (delegated): only running slots get days, an ended slot gets a refund
instead; no all-accounts version; no automatic member email.

- Payments & refunds, below 'Needs attention' (staff with the refund permission
  only): an 'Add lost days' card. 'When a member lost paid days (a wrongly
  rejected post, a slot that didn't work, the site down more than 24 hours, or
  an overturned suspension). Days go on every running paid slot and package, at
  most 30 days in all per slot. Beyond that, or for an ended slot, refund
  instead. We don't email the member.' and a button
  'Add lost days'.
- The button opens 'Member's account email' with 'Check slots' and 'Cancel'.
  Checking lists the member's running paid terms: 'Individual slot', 'Individual
  slot (renewal queued)' or 'Package of 12 slots', each with 'Ends 22 December
  2026'. A member with none: 'This member has no running paid slot or package,
  so there is nothing to add days to. An ended slot gets a refund instead.' and
  'Close'. Changing the email clears the list.
- Under the list: 'Days' (1 to 30) and 'Reason (audited)' (5 to 500 characters,
  placeholder 'Site down 3 to 5 December'). As soon as a valid number is typed,
  each line shows its new end ('Ends 22 December 2026 → 29 December 2026') and
  the button reads 'Add 7 days'. After adding: 'Added 7 days to
  thandi@example.co.za.' and the list of what moved with the end before and
  after; the form closes. Refusals in plain words (no active account, nothing
  running, more than 30 days in all for a slot ('A slot can get at most 30 lost
  days in all, and this would go over. Refund the member instead.'), the slots
  changed just now, the admin's own account, no accepted ID
  review of their own, not an admin, a bad number or reason). A stale
  authenticator code sends the admin to verify again and back. Retrying the
  same change never adds the days twice.
- Members: My slots, My posts and the posts themselves show the later end
  dates; nothing else changes and nobody is emailed.

Pictures (synthetic data, local preview, not published):
`screenshots/item75-lost-days/` (desktop 1280 and phone 375): the closed card,
the checked slots with the new ends, and the result. Retaken after the 30-day help
line as `lost-days-v2-*` (the first set, `lost-days-*`, shows the older line).

Decision: approved by owner 2026-11-25 (after seeing the `lost-days-v2-*` pictures; answer: 'Approve both', for the pictures and the database update).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/admin/commercial/lost-days-panel.tsx` | visual | Group 100: the new 'Add lost days' card: check a member's running paid slots, then add 1 to 30 days with a reason through the commercial route. Group 109: a checked slot or package that already had money back for days we failed to provide says so. | Staff with the refund permission: everything described in group 100. Group 109: under such a slot or package in the checked list: 'R… was already refunded for days we failed to provide. Give money or days for one failure, not both.' | keep | approved by owner 2026-11-25 (answer: 'Approve both'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | bf80d25e321e |
| `src/components/admin/commercial/lost-days-panel.test.tsx` | test | Group 100: checks the closed card, checking and adding with the new ends, the same request id on retry, nothing running, the day and reason checks, the re-verify redirect and clearing on a new email. Group 109: the money-already-refunded note. | Nothing (not part of a page) | keep | approved by owner 2026-11-25 (answer: 'Approve both'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 26bedf9e7223 |

### 102. Lost-email alert and staff deadline emails (item 28)

Email only: no file in the checked scope changes, so this group has no file
rows. Launch checklist item 28. Database update
`20261125131322_lost_email_alert_staff_deadlines.sql` (pending, apply first).
The words are new (owner rule 4). Text outside the checked scope:
`src/lib/services/email.ts` (`sendStaffDeadlineEmail`,
`sendLostEmailAlert`).

Staff deadline email, to each staff member whose role handles it, except whoever
submitted it and the person a report is about; at most 30 a day across all
staff. Subject, for example: 'VerifyMzansi staff: new report (fake
listing, high priority), due 01 Dec 2026, 15:00'.

> A new report is waiting. Deal with it by 01 Dec 2026, 15:00.
>
> Reason: fake listing, high priority
> Reference: VM-…
> Received: 27 Nov 2026, 15:00
> Deadline: 01 Dec 2026, 15:00
>
> Sign in to the staff pages to read and handle it. The deadline counts
> business days, skipping weekends but not public holidays.

Button 'Open the report' (privacy requests: 'Open the privacy request' to the
privacy requests page; appeals: 'Open the appeal' to that appeal). Deadlines: a
privacy request's due date; an appeal 3 business days and a report 2 business
days after it came in (the appeal target matches the contact page's published
"2–3 business days"). No name, address or text the member wrote.

Lost-email alert, to the support address: unchanged title 'Queued emails not
confirmed delivered'; each row now also says when the email was queued, a line
says how many more are not listed ('1 more is not listed here.', '2 more are
not listed here.'), and a button 'Open operations' links to the staff operations
page instead of the Worker logs.

Pictures (synthetic data, not sent, not published): `screenshots/item28-emails/`
(375 and 1280 wide): the staff report deadline email, the staff privacy request
email and the lost-email alert.

Decision: approved by owner 2026-11-25 (answer: 'Approve with the fix', for the
three email pictures, with '1 more is not listed' fixed).
### 104. Staff refunds: first purchase and part refunds (item 77)

Launch checklist item 77. The posting terms (posting-v6) promise a first
purchase cancelled within 5 business days, refunded in full, and refunds of
part of a payment (unused whole days less the R50 fee, or a reasonable part
for days we failed to provide). Database update
`20261125133916_staff_part_refunds.sql` (pending, apply first): commands
`api.record_staff_refund` (payments:refund, an authenticator code from the
last 15 minutes) and `api.get_staff_refunds_left` (payments:view).

- Payments & refunds, the refund forms ('Record refund', 'Paid back by bank
  transfer', 'Refund this slot', and while refunds through Ozow are used,
  'Refund through Ozow' and 'Recorded in the Ozow dashboard'), refunds only:
  under the reason, 'Left to refund: R…' (with what was already returned on
  the payment) and 'Amount to refund (rand)', filled with what is left. Staff
  may lower it for a part refund. A line under it says what happens: 'The paid
  days end now: the slot is withdrawn and its posts are hidden.' or 'Only money
  goes back: the slot keeps running.' (a part refund for 'Our failure, after a
  fix was offered' or 'Billing error').
- For a cancellation or a credit for our breach: 'Unused whole days: N of M
  (paid until …). At the daily price, less the R50 fee: R…. Count the days from
  the end of the 20 business days' notice.' (a suggestion; staff enter the
  amount).
- 'Duplicate payment', 'Cancelled before the renewal started' and the first
  purchase refund everything left: the amount is shown and cannot be changed.
- The reason 'First purchase cancelled (within 5 business days)' is offered
  only for the whole payment of an account's first purchase. It adds 'Customer
  asked in writing on' (a date, required) and 'The first purchase may be
  cancelled if the customer asked by … (5 business days after the payment was
  confirmed).'
- Refusals in plain words (more than is left, not the first purchase, asked
  too late, a bad date, this reason refunds everything left, and the existing
  ones). A whole refund with nothing returned before, and every chargeback,
  are recorded exactly as before.
- When what is left cannot be read, the forms are exactly as before (whole
  refunds only, no first-purchase reason).

Pictures (synthetic data, local preview, not published):
`screenshots/item77-refunds/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-25 (answer: 'Approve them').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/admin/commercial/refund-amount.tsx` | visual | Group 104: the amount, first-purchase date and slot-effect fields shared by the refund forms. Group 109: the unused-days hint counts paid days from the end of the 20 business days' notice over the plan's own term, without free lost days; a note when lost days were already added to the slot. | Staff with the refund permission: everything described in group 104. Group 109: the cancellation hint reads 'Unused paid days after the 20 business days' notice (it ends <date>): N of M (paid until <date>; the N days added for lost days are free and not counted). At the daily price, less the R50 fee: R….' (until the database update is applied: 'Unused whole days if recorded today: N of M (paid until <date>). …'); when lost days were added to the slot, '<N> days already added to this slot for lost days. Give money or days for one failure, not both.' | keep | approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | eae1d117ddcc |
| `src/components/admin/commercial/refund-amount.test.tsx` | test | Group 104: reading rands, what the request carries, the slot effect, the unused-days suggestion and the fields. Group 109: the notice-end hint over the plan's term without lost days, the 'if recorded today' fallback and the lost-days note. | Nothing (not part of a page) | keep | approved by owner 2026-11-25 (answer: 'Approve them'); group 109 part approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 1fb000057614 |

### 103. Showroom video posts show their chosen frame and logo

Returns the 27 October behaviour (`0b562f42`, `carousel-item-transforms.ts`)
to the big showroom carousel on the home page and the Mzansi Market, Mzansi
Business and Tourism & Events pages. The showroom read gave each card only its
preview picture, which a video-only post does not have, so the carousel showed
`/images/fallbacks/hero-shop.svg`, never started the video, and showed the
title's first letter where the post's logo belongs. The cards now also carry
the owner's chosen video frame (used only when there is no preview picture) and
the post's logo, from the public card presentation read. The carousel itself is
unchanged. A page waits at most 1.5 seconds for those reads; a card whose read is
slower looks as it does today until a later visit.

Rows: none; the change is in `src/lib/showroom/feed.ts` (outside the checked
scope) and its unit test.

Pictures (live public data, read only, not published):
`screenshots/showroom-video-cover/` (phone 375 and desktop 1280, home and
Tourism & Events).

Decision: approved by owner 2026-11-25 (answer: 'Approve them', for the before and after pictures).

### 105. Small lifecycle rules (item 40)

Launch checklist item 40. Database update
`20261125150215_small_lifecycle_rules.sql` (pending, apply first). Three
rules; the words are new (owner rule 4). Text outside the checked scope:
`src/lib/services/email.ts` (`sticker_renewal_reminder`,
`STICKER_RENEWAL_BODY`) and `src/lib/foundation/restored-post-actions.ts`
(`REPORTED_POST_MESSAGE`).

- Free events at most 12 months ahead: the form already refuses a later start;
  the database now refuses it too. Nothing changes on screen.
- A reported post: on My posts, 'Delete' then 'Yes, delete' on a post with an
  open report shows, under the buttons: 'Someone reported this post. You can
  hide it now, and delete it once our team has looked at the report.' The post
  stays. Hiding it still works, and once staff have closed the report it can be
  deleted as before.
- Sticker renewal: one email 30 days before a CIPC registered or Seen by
  VerifyMzansi sticker ends (not for a profile linked to another company, which
  renews with it; not while a renewal is already waiting for review). Subject:
  'Your VerifyMzansi sticker needs renewing soon'.

  > The CIPC registered sticker on one of your businesses ends on 20 December
  > 2026 at 12:00 (South African time).
  >
  > Renew it now from the business's verification page so the sticker does not
  > lapse. Our team checks your company against CIPC's records again. A renewed
  > sticker lasts 365 days from the day it is approved.

  Button 'Renew my sticker'. For Seen: 'The Seen by VerifyMzansi sticker ...',
  'Book a new Seen check now from the business's verification page so the
  sticker does not lapse. A renewed sticker lasts 365 days from the day it is
  approved.' and the button 'Book a Seen check'. Both link to that business's verification page.
- Business verification page, Seen by VerifyMzansi: from 60 days before the
  sticker ends (as CIPC's 'Renew now'), the line under the sticker adds
  '· renew by 20 Dec 2026' and the existing booking form ('How should we see
  your business?', three times, consent, 'Book my check') shows under it, so
  the next check can be booked before the sticker ends. Before that, nothing
  changes.

Pictures (synthetic data, local preview, not published):
`screenshots/item40-lifecycle/` (desktop 1280 and phone 375): the delete
refusal on My posts, the Seen step with the booking form, and the two
emails.

Decision: approved by owner 2026-11-25 (answer: 'Approve with the rewording', the pictures with the sticker email reworded).

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/business-verification/owner-verification-panel.tsx` | visual | Group 105: the Seen step shows 'renew by' and the existing booking form from 60 days before the Seen sticker ends, as CIPC's renewal does. Group 112: every date on the panel is shown in South African time, whatever the browser's time zone. | Business owners with a Seen sticker ending within 60 days: everything described in group 105. Group 112: owners whose browser is set to another time zone may see a date one day different (now the South African date, as in the reminder email); in South Africa nothing changes. | keep | approved by owner 2026-11-25 (answer: 'Approve with the rewording', the pictures with the sticker email reworded); group 112 part approved by owner 2026-11-26 (answer: 'Yes to both') | 2026-11-26 | 99192bec3c77 |

### 106. Removing an admin needs approval; appeal pages off the old backend (item 20, part 1)

Launch checklist item 20. Database update
`20261125150338_admin_removal_needs_approval.sql` (pending, apply first):
`internal.propose_frontend_staff_role` now applies a lowering at once only for a
moderator or governor; lowering an admin waits for a different admin to approve
it on the Staff roles page (never the proposer, never the admin it is about).
The member appeal pages read the signed-in member through the live backend
instead of the old one; they look and behave the same.

- Staff roles (admins): the header line reads 'Promotions need an independent
  approver. Removing an admin needs another admin's approval.' (was 'Removals
  by an admin take effect immediately.'). Removing an admin now shows under
  'Waiting for approval' with the existing Approve and Reject buttons (the
  proposer sees 'Waiting for someone else to approve your proposal.', the admin
  it is about sees 'This change is about you, so someone else must review it.').
- Decisions and appeals (`/appeals`, `/appeals/new`): no visible change.
  Signed-out visitors are still sent to sign in and back.

Pictures (synthetic data, local preview, not published):
`screenshots/item20-appeals/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-25 (answer: 'Approve them').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/appeals/page.tsx` | rewiring | Group 106: reads the signed-in member through the live backend (the old backend's client is no longer imported). | Nothing (same look and steps) | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | e8b823e91d95 |
| `src/app/appeals/new/page.tsx` | rewiring | Group 106: reads the signed-in member through the live backend (the old backend's client is no longer imported). | Nothing (same look and steps) | keep | approved by owner 2026-11-25 (answer: 'Approve them') | 2026-11-25 | dd72d0883f19 |

### 107. Change a verified phone number or place (item 20, part 2)

Launch checklist item 20. Database update
`20261125161326_change_verified_place.sql` (pending, apply first): a member
may change their province and city at most once every 15 days, and each change
is recorded (and listed in their privacy export). The phone change uses the
existing SMS-code rules (a new code, at most every 15 days, after the ID
review); only the website changes for it.

- My profile, phone: the number is shown read-only. Under it, a 'Change number'
  button opens the phone step in change mode; during the 15 days after a change
  the existing line 'Phone changes unlock on 10 December 2026.' shows instead.
  (Before: the field could be typed in, and saving a different number failed
  with 'Verify your new phone number before changing it'.)
- Phone step in change mode (`/dashboard/complete-profile?change=1`): title
  'Change your phone number', the line 'We send a 6-digit code by SMS to your
  new number. Your current number stays until the new one is verified.', card
  'Your new mobile number', an empty number field, then the same code and
  'This phone number is verified.' steps; 'Continue' returns to My profile.
  Refusals show under the field with the existing messages (in use, not
  available, too soon, ID review needed).
- My profile, place: province and city are always editable (before: shown
  locked once confirmed). Once a place is confirmed the line 'You can change
  your province and city once every 15 days.' shows under them. A change
  within 15 days is refused with 'You can change your province and city again
  after 10 December 2026.' (before: 'Your confirmed location cannot be changed
  here. Request a verification review').

Pictures (synthetic data, local preview, not published):
`screenshots/item20-phone-place/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-25 (answer: 'Approve them'), for the pictures.

### 111. Showroom cards with a video and photos show the chosen frame (item 56)

Launch checklist item 56, follow-up to group 103. Returns the 27 October
behaviour (`0b562f42`, `carousel-item-transforms.ts`: the video's chosen frame
first, then the first photo) to the big showroom carousel on the home page and
the three area pages. Group 103 used the chosen frame only when a post had no
photo, so a post with a video and photos showed its first photo under the
video. Now, when a post has a video, the chosen frame comes first and the first
photo only when there is none. The carousel itself is unchanged.

Rows: none; the change is in `src/lib/showroom/feed.ts` (outside the checked
scope) and its unit test.

Pictures (synthetic data, local preview, not published; no live post has both a
video and photos): `screenshots/item56c-showroom/` (Tourism & Events, phone 375
and desktop 1280, before and after).

Decision: approved by owner 2026-11-26 (answer: 'Yes to everything').

### 108. Staff told to end an admin role before restricting that person (item 20, part 3)

Wording only: no file in the checked scope changes, so this group has no file
rows. Launch checklist item 20, part 3. Database update
`20261125174942_end_admin_role_before_restriction.sql` (pending, website
first): a ban, suspension or emergency containment of a person who holds an
active admin role is refused. Text outside the checked scope:
`src/lib/foundation/staff-command.ts`.

- Staff only, on Reports (Ban, Suspend, emergency containment) and on
  Governance (Approve): when the person holds an admin role, the action is
  refused and the existing error line reads 'End this person's admin role
  first. Another admin must approve that, then try again.' instead of 'The item
  could not be confirmed. Reload the queue before continuing.'.
- Nothing else changes; actions on everyone else are as before.

Pictures (synthetic data, local preview, not published):
`screenshots/item20-part3/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-25 (answer: 'Approve it').

### 109. Staff refund follow-ups (item 56, batch A)

Launch checklist item 56, batch A: the Low findings of the reviews of group
104 (staff part refunds). Database update
`20261125194727_part_refund_follow_ups.sql` (pending, **website-first**: this
website reads the new fields as optional; the update is applied after it is
deployed). Warnings only: nothing new is refused on the screen. Text outside the
checked scope: `src/lib/services/email.ts` (`payment_reversed`) and
`src/lib/foundation/staff-payments.ts` (the 'activate first' refusal).

- 'Payment update' email (every refund or reversal, including a part refund
  that keeps the slot running): 'A refund or reversal of a payment has been
  recorded. Review the current details in Billing.' (was 'A payment reversal
  has been recorded. Review the current details in Billing.').
- Refund forms, 'Cancellation (section 14)' or 'Credit for our breach': for
  example 'Unused paid days after the 20 business days' notice (it ends 24 Dec
  2026): 145 of 180 (paid until 19 May 2027; the 10 days added for lost days
  are free and not counted). At the daily price, less the R50 fee: R283.50.'
  The days count from the end of the notice over the plan's own term (never
  more than the slot's own paid days: slots added to a package use their own
  dates); free lost days come off the end. Until the database update is applied: 'Unused
  whole days if recorded today: …' (was 'Unused whole days: …. Count the days
  from the end of the 20 business days' notice.').
- Refund forms, when lost days were added to the slot: '10 days already added
  to this slot for lost days. Give money or days for one failure, not both.'
- Add lost days, under a checked slot or package that already had money back
  for days we failed to provide (applied refunds of that slot, or of a payment
  for that slot only): 'R25 was already refunded for days we failed
  to provide. Give money or days for one failure, not both.'
- 'Record chargeback' / 'Slot chargeback', when money was already returned on
  the payment (refunds and chargebacks together): 'Already returned R30 on this
  payment. A chargeback returns the full amount again: check with Ozow or the
  bank before recording it.'
- A part refund that keeps the slot running, on a payment still waiting for
  'Activate what was paid for', is refused: 'This payment is not activated yet.
  Use 'Activate what was paid for' first, then refund part of it. If you cannot
  activate it, record a refund that ends the slot.'
- Opening a refund form again after a lost answer sends the same request, so
  the database returns the first refund instead of recording (or sending to
  Ozow) a second one. Nothing changes on screen.

Pictures (synthetic data, local preview, not published):
`screenshots/item56a-refunds/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-26 (answer: 'Yes to everything').

### 117. Invoice payment link and invoice email (items 34 and 38)

Launch checklist items 34 and 38 (inventory A28). Database update
`20261126053701_invoice_pay_link.sql` (pending, apply first). A staff invoice
is emailed to the customer with a payment link; whoever has the link can see
and pay the invoice without signing in, with the existing pay panel. Text
outside the checked scope: `src/lib/services/payment-receipt-email.ts` (the
invoice email and the receipt row) and `src/lib/services/email.ts`.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/pay-invoice/page.tsx` | visual | New: the invoice payment link page (no sign-in; the link's token names the invoice). | Anyone with the emailed link: the invoice document and, beside it (below on phones), the same pay panel as the member's invoice page (billing details, the cooling-off box, Pay now, printing); a paid or cancelled invoice shows printing only. Back from Ozow: 'Thank you' and 'Once Ozow confirms the payment, the invoice shows as paid and a receipt is emailed to the account holder. To check, open the payment link in the invoice email again.'; after a cancel: 'Payment not completed' and 'Nothing was paid. To try again, open the payment link in the invoice email.'; a link that has expired or does not work: 'This payment link has expired or does not work' and 'Please ask the account holder to sign in and pay it, or email billing@verifymzansi.com.' (wording approved by owner 2026-11-26) | keep | approved by owner 2026-11-26 | 2026-11-26 | 96a21b99fda3 |
| `src/components/billing/invoice-with-pay-panel.tsx` | helper | Shared by the member's invoice page and the invoice payment link page: the invoice document and, beside it, the payment panel (moved from the member's invoice page, unchanged; on the link page the panel posts the link's token and the document says Pay now is on this page). | Nothing new (the same document and panel) | keep | approved by owner 2026-11-26 | 2026-11-26 | 18307963f547 |
| `src/app/pay-invoice/page.test.tsx` | test | Tests for the payment link page: never indexed, no referrer, the invoice with the link's token, the three messages. | Nothing (not part of a page) | keep | approved by owner 2026-11-26 | 2026-11-26 | 4a25bafaee53 |

- Invoice email (new; every invoice staff issue): subject 'Invoice VM-2026-000012
  from VerifyMzansi'; 'Your invoice', 'VerifyMzansi sent you an invoice. You can
  view and pay it without signing in.'; 'Invoice number', 'Item', 'Amount due',
  'Due date'; 'Anyone with this link can see and pay the invoice, so share it
  only with the person who pays it. Prefer a bank transfer? The bank details
  are on the invoice; use the invoice number as your reference.'; button 'View
  and pay invoice'. Each sending has a new link; older links stop working.
- Invoice document, on the payment link page only: 'How to pay' reads 'Pay
  online with Ozow, straight from your bank: choose Pay now on this page. ...';
  printed, and everywhere else, it keeps 'sign in at verifymzansi.com, open this
  invoice under Invoices and choose Pay now'.
- Payment link page, when Pay now is refused because of the account behind
  the invoice (its ID review, another open payment, its slot limit or its
  package, or opening the Ozow request is refused for the account): one message
  under the button, 'This invoice can't be paid online right now. Please ask the
  account holder to sign in and pay it, or email billing@verifymzansi.com.'
  (approved by owner 2026-11-26) Refusals about the invoice itself (paid, cancelled, a bank
  transfer being checked, a changed total) keep their words. The member's
  invoice page is unchanged.
- A payment link stops working 30 days after the invoice's due date; it then
  shows the same 'This payment link has expired or does not work' page
  (approved by owner 2026-11-26).
- 'Payment received' email for an invoice payment (Ozow or bank transfer): a
  row 'Invoice paid: VM-2026-000012' under 'Invoice number' (the receipt's own
  INV- number). Label to be chosen by the owner.

Pictures (synthetic data, local preview, not published):
`screenshots/item38-34-invoice-link/` (desktop 1280 and phone 375; emails at
one width).

Decision: approved by owner 2026-11-26.
### 110. Release one blocked phone number (item 21)

Launch checklist item 21. Database update
`20261125213005_release_one_phone_number.sql` (pending, apply first): commands
`api.propose_phone_number_release`, `api.review_phone_number_release` and
`api.get_phone_number_releases` (account:restore: admins and governors, an
authenticator code from the last 15 minutes). A ban blocks every phone number
the banned person verified; staff can now free one number (a number the network
gave to someone else, or one blocked by mistake) while the ID ban stays. One
staff member asks, a different one approves. Approval also ends the banned
account's own hold on that number, so its new holder can verify it.

- Restrictions (`/admin/governance/enforcement`), between 'Active restrictions'
  and 'Recent enforcement actions': a 'Blocked phone numbers' card. 'Free one
  number a ban blocks, for example when the network gave it to someone else.
  The person's ID ban stays. A different staff member approves.'
- A form: 'Phone number' (082 123 4567, 27821234567 or +27 82 123 4567) and
  'Why' (10 to 500 characters), with 'Ask to release'. Checked before sending
  ('Enter a South African number, for example 082 123 4567.', 'Explain why in at
  least 10 characters.').
- 'Waiting for approval': each number with who asked ('You' for your own), when,
  when it expires (7 days) and the reason. Others see 'Approve' and 'Reject'; the
  person who asked sees 'Waiting for another staff member.' and 'Withdraw'; a
  staff member who verified that number themselves sees 'You verified this
  number, so someone else must decide.' and no buttons. 'None.' when empty.
- 'Released': the latest 50, each with the date, 'asked by Thando D., approved by
  Lerato M.' and the reason. 'None.' when empty.
- Refusals in plain words (no running ban blocks the number, a request already
  waits, nothing waits any more, your own request, a number you verified, the
  person who asked lost the permission or another ban now lists the number). A
  stale authenticator code sends staff
  to verify again and back. If the list cannot be read, the card says so and the
  rest of the page still works.
- Members: nothing is shown or sent. Whoever holds the number now can verify it
  as usual.

Pictures (synthetic data, local preview, not published):
`screenshots/item21-phone-release/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-26 (answer: 'Yes to everything').

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/app/admin/governance/enforcement/phone-releases-card.tsx` | visual | Group 110: the new 'Blocked phone numbers' card: ask to release a number, approve, reject or withdraw a waiting request, and see the latest releases. | Admins and governors on Restrictions: everything described in group 110. | keep | approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | 9562ebd8e1c9 |
| `src/app/admin/governance/enforcement/phone-releases-card.test.tsx` | test | Group 110: checks what each staff member may do, the stored number sent, the checks before sending, a refusal, the re-verify redirect and the unreadable list. | Nothing (not part of a page) | keep | approved by owner 2026-11-26 (answer: 'Yes to everything') | 2026-11-25 | d91db81a8f08 |

### 112. Lifecycle rule follow-ups (item 56, batch D)

Launch checklist item 56, batch D: follow-ups to group 105 (item 40). Database
update `20261125225855_lifecycle_rule_follow_ups.sql` (pending, apply first).
No new screen; one new message and one date change. Text outside the checked
scope: `src/lib/foundation/restored-post-route.ts`.

- Business verification page (`/dashboard/businesses/<id>/verification`):
  every date on the panel ('Checked …', '· renew by …', the Seen line and the
  message dates) is shown in South African time. Before, it followed the
  browser's time zone, so an owner abroad could see a 'renew by' date one day
  off from the reminder email, which says South African time. In South Africa
  nothing changes.
- Posting or editing a free event: if the database refuses a start more than 12
  months ahead (the form already refuses it, so only a stale form gets here),
  the message under the form reads 'Events can start at most 12 months ahead.'
  instead of 'Check the category, dates, media and posting allowance before
  submitting'.
- My posts, deleting a reported post: the message ('Someone reported this post.
  You can hide it now, and delete it once our team has looked at the report.')
  is unchanged, but it now shows only for a report from the public, and only
  until both of these have passed: 7 days from the report, and the scheduled
  clean-up's waiting time (67 days after the post's last change, or 7 days
  after its deletion date). A staff duplicate-event flag no longer stops the
  owner deleting.

Pictures: none (the wording above is the whole change; the date looks the same
in South Africa).

Decision: approved by owner 2026-11-26 (answer: 'Yes to both').

### 119. Catalogue filters run in the database (item 29)

Launch checklist item 29. Database update
`20261126062428_catalogue_filters_in_database.sql` (pending, apply first).
No layout change. Data only outside the checked scope:
`src/lib/foundation/marketplace-read.ts`, `feed-read.ts` and `post-search.ts`.

- An organisation's 'Supported businesses' list (`/organisation/<slug>`, with
  its programme and 'Sponsored only' filters) and Mzansi Business with an
  organisation filter: one database read per page instead of reading every
  business. The same businesses, order and count; a business past the first
  4,800 of an area is no longer missed. A programme is matched by its id, not
  its name (different only if two programmes of one organisation shared a
  name).
- Mzansi Business text search without a category (which also finds stays and
  tourism places): one database read. Behaviour at more than 480 results: the
  page links go on to 100 pages, as every other search does, instead of
  stopping after 480 results ('Showing the first 480 results' becomes the
  usual 'Showing the first 2,400 results' at that size).
- Video mode: the list of up to 200 posts for a section loads in one database
  read. The posts and their order are the same.

Pictures: none (no layout change).

Decision: awaiting owner.
### 113. Video length checked by the database (item 39)

Launch checklist item 39. Database update
`20261126001956_video_length_checked.sql` (pending, apply first): the upload
server stores each video's length (read from the file) through the new
`api.complete_frontend_video_upload`; submitting a post refuses a video longer
than its kind allows (events 1 minute, everything else 2 minutes; a video
stored before the update has no length and is not checked); staff read the
lengths through `api.get_frontend_staff_video_lengths`.

- Content moderation (staff), a claimed post with a video: under the photos
  and video, 'Video length: 1 min 35 s (limit 2 minutes)'; for an event 'limit
  1 minute'; 'not recorded' for a video stored before lengths were kept.
  Also in the business review, under
  'Business media'.
- Sellers, when submitting (create, edit, resubmit or reactivate): a refusal
  in the existing error message, 'Your video is 1 min 30 s; the limit is 1
  minute'. Nothing else changes on the posting forms.

File rows: the group 113 part of the
`src/components/admin/moderation/moderation-preview-panel.tsx` and
`moderation-preview-panel.test.tsx` rows in earlier groups.

Pictures (synthetic data, local preview, not published):
`screenshots/item39-video-length/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-26.

### 120. Post viewer: one message for an empty section (item 81)

Launch checklist item 81, a live bug the owner found. In the post viewer, a
section with no posts showed two messages on top of each other: 'Nothing here
yet' and the end card 'You’re all caught up'. The 27 October viewer had the
same overlap. Behaviour fix only; no new design.

Pictures: `screenshots/item81-viewer-empty/` (375 and 1280, after the fix).

Decision: approved by owner 2026-11-26.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/immersive/immersive-viewer.tsx` | wording-behaviour | Group 120: an empty section shows only its own 'Nothing here yet' message, without the end card or the up and down arrows. | Post viewer, after switching to a section with no posts (for example Mzansi Business while it has none): only 'Nothing here yet' shows; the 'You’re all caught up' end card no longer shows on top of it, and the up and down arrows are hidden there (they did nothing and covered the message on phones). Sections with posts still end with the end card. | keep | approved by owner 2026-11-26 | 2026-11-26 | e39f6a9b04da |
| `src/components/immersive/immersive-interactions.test.tsx` | test | Group 120: tests that an empty section shows one message and no arrows, and a section with posts still ends with the end card. | Nothing (not part of a page) | keep | approved by owner 2026-11-26 | 2026-11-26 | 4d9ab7ce8382 |

### 951. Keep-for periods: payment records 7 years (item 51)

Launch checklist item 51. Database update
`20261126053631_keep_for_periods.sql` (applied 2026-11-26 20:15 UTC) keeps payment,
invoice and payout records 7 years (was 5) from the end of the tax year
(settled legal answer D5, Companies Act s24) and the minimised record of a
closed data-rights request 3 years (was 5). The website says the same:

- Privacy Policy, 'Payment data' row: 'Kept for 7 years after the end of the
  tax year (1 March to the end of February) in which the payment was made, as
  company and tax law require' (was 'Kept for 5 years ... as tax law
  requires').
- Privacy Policy, 'Data retention and deletion': '... and the record of it is
  kept for 3 years.' (was '5 years'); after 'Notices in your account are
  deleted after 90 days.' a new sentence: 'Messages sent through the contact
  form are deleted 12 months after they are resolved.'
- Delete account dialog: 'Payment records and invoices are kept for 7 years, as
  company and tax law require.' (was 'kept for 5 years for tax, as the law
  requires').

Pictures (local preview, not published): `screenshots/item51-keep-for/`
(desktop 1280 and phone 375).

Decision: approved by owner 2026-11-26.

### 116. Media copy URLs only for uploaded photo keys (item 78)

Launch checklist item 78 (old backend leftovers); nothing changes on screen.
The media serve route now falls back to the photo only for a missing
`media/<uuid>.w<N>.webp` copy, so the image loader builds copy URLs only for
`media/<uuid>` keys, and the unused `getVariantUrl` and
`getResponsiveImageUrls` helpers are removed (both in files outside the
checked scope). Every uploaded photo and poster is stored as `media/<uuid>`,
so their URLs are unchanged. File rows: the group 116 part of the
`src/components/ui/profile-video-player.tsx` and its test rows in group M10.7.

Decision: approved by owner 2026-11-26.

### 115. Test and plumbing leftovers before public opening (item 56, batch E)

Launch checklist item 56 (follow-ups 29, 30, 31, 34, 36 and the tests for
8, 15, 32, 37, 41, 42; follow-up 28 moved to item 80). No visible change and
no database change.

- Edit listing, business and tourism (and a copied listing): the posting terms
  are accepted before new photos or videos upload, so a failed acceptance
  leaves no uploaded files behind.
- Create business and Create tourism use the same posting-terms tick as the
  other forms (same words, colours and place as before).
- Create listing: the form is keyed on the copy it was opened with, so a page
  kept alive between visits never mixes a copy with the ordinary form or a
  template.
- My profile: leaving within 1.5 seconds of closing the account still loads
  the next page in full.

Decision: approved by owner 2026-11-26.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/post/posting-terms-consent.test.tsx` | test | Group 115: checks the wording and colours of each form's tick. | Nothing (not part of a page) | keep | approved by owner 2026-11-26 | 2026-11-26 | b8623b0c689a |

### 114. Website leftovers before public opening: wording and screens (item 56, batch E)

Launch checklist item 56 (follow-ups 9, 16, 23, 25, 33, 35, 38, 39). Wording
and small screen fixes; no database change.

- Checkouts (Individual slot, Choose your package, Add slots): a small grey
  line 'No VAT is charged.' under the total (decision C3: VerifyMzansi is not
  registered for VAT).
- Choose your package: when the package prices cannot be loaded, the red
  message reads 'We couldn't load package prices just now. Refresh the page or
  try again in a few minutes.' and nothing can be paid or asked for (it used to
  say 'Multi-listing packages are not on sale yet.').
- Delete account dialog: closing counts as a request to cancel 'all your
  slots and your Multi-listing package'. The payment records line stays at 5
  years (and the Privacy Policy is unchanged) until item 51 changes what the
  database keeps; the pictures showed 7 years.
- Advertise, 'Can I cancel?': adds the first-purchase refund within 5 business
  days, how refunds are paid, and the package; 'Closing your account counts as
  a request to cancel all your slots and your package' (as Terms posting-v6
  Refunds & cancelling).
- My posts, Resubmit refused because the current posting terms are not
  accepted: the message gains a link 'Open Edit to accept them'.
- Edit forms: a dropped connection while accepting the posting terms says
  'We couldn't reach VerifyMzansi to accept the posting terms. Check your
  connection and try again.' instead of naming the upload service.
- My posts loading placeholder: the removed 'Promote' pill is no longer drawn.
- Card code: the Urgent label, the Featured badge and the boosted star are
  removed; they could not show (no read carries a paid add-on).

Pictures (synthetic data, local preview, not published):
`screenshots/item56e/` (desktop 1280 and phone 375).

Decision: approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51.

| File | Kind | Reason | What changes on screen | Proposed | Owner decision | Date | Version |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/components/listings/resubmit-button.test.tsx` | test | Group 114: checks the Edit link and that other refusals have none. | Nothing (not part of a page) | keep | approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 1e38d01b731a |
| `src/app/dashboard/listings/loading.tsx` | visual | Group 114: the loading placeholder no longer draws the removed right-hand 'Promote' pill (group 98 removed the button). | My posts while loading: each placeholder card shows two grey button shapes, not three (no rounded pill on the right), so nothing jumps when the posts appear. | keep | approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | b44830949ff8 |
| `src/components/listings/listing-card-status.ts` | helper | Group 114: removes the 'Urgent' card label (paid add-ons removed, group 98; no read carries it). | Nothing (the label could not show) | keep | approved by owner 2026-11-26 (answer: 'Yes to both'), retention line kept at 5 years until item 51 | 2026-11-26 | 18204415ccf7 |

### 125. Posting forms: service areas saved; errors name the right step and field (item 84 part B)

Launch checklist item 84 part B (forms proposal Phase 1, approved by the
owner). Behaviour and wording fix only; no new design.

- Create business and Edit business send the service areas typed under 'I
  travel to customers'. Before, create sent an empty copy from an old field,
  so the server refused every such business with 'Service Areas.areas: Add at
  least one service area'; edit sent the areas loaded with the page and lost
  changes.
- A server error opens the step that shows the field and the banner names
  that step, on Create listing, Create business and Create tourism. Unknown
  fields still open Step 1.
- The error banner shows the field's form label (or a plain name made from
  the field, such as 'Property type') and plain words instead of raw schema
  text: 'Choose one of the options.', 'Must be at least 5 characters', 'Must
  be at most 100 characters', or 'Check this field.' when nothing more can be
  said. Messages the forms write themselves are unchanged.

File rows: the group 125 part of 7 rows in earlier groups.

Pictures (synthetic data, local preview, not published):
`screenshots/item84-errors/` (one error banner before and after, at 375 and
1280).

Decision: awaiting owner.

<!-- frontend-ledger:end -->


## Put back

Files returned to `0b562f42`, kept as a record. The check does not read this
section.

| File                                                  | Put back on                                                                                              | How                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/components/listings/business-filter-drawer.tsx`  | Prepared 2026-11-08; live when the owner merges "Owner choice: put back the phone and tablet filter tab" | put back (owner merged): `git checkout 0b562f42`; right-edge Filters tab and Business Sponsor filter return |
| `src/components/listings/listing-filter-drawer.tsx`   | 2026-11-08, same change                                                                                  | put back (owner merged): `git checkout 0b562f42`; right-edge Filters tab returns                            |
| `src/components/listings/promotion-filter-drawer.tsx` | 2026-11-08, same change                                                                                  | put back (owner merged): `git checkout 0b562f42`; right-edge Filters tab returns                            |
| `src/components/layout/prelaunch-banner.test.tsx` | 2026-11-18, same change | put back: `git checkout 0b562f42` |
