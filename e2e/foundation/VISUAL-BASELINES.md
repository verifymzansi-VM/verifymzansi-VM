# Visual baselines on the foundation test copy

The required check `Visual regression (chosen frontend)` compares 33 pictures
(10 screens at 375, 800 and 1280 px, plus 3 screens in dark mode at 1280 px).
It moved from the retired backend's in-memory stub (`e2e/visual-regression.spec.ts`)
to the private local foundation test copy (`visual-regression.spec.ts` in this
folder). The screen list, viewports, settling steps and the allowance
(threshold 0.05, at most 20 differing pixels) are unchanged.

## How the pictures are made

- `node --import tsx scripts/foundation-e2e.mjs up` and `build`: the local
  Supabase stack built only from `database/foundation/`, seeded with the test
  people and posts (`scripts/lib/foundation-e2e-seed.mjs`), and the website
  built in foundation mode.
- `node --import tsx scripts/foundation-visual.mjs`: serves that build on
  `127.0.0.1:3110` on the host and runs Playwright inside
  `mcr.microsoft.com/playwright:v1.64.0-noble` (pinned by digest in the script)
  with `docker run --network host`, so the browser build and fonts are those of
  the pinned image, as before.
- New pictures: the same command with `--update-snapshots=changed`, or the
  "Update Visual Baselines" workflow. Only for a screen change the owner approved.

## Data and masking

The old suite hid all posts (the stub's hide-fixtures cookie), so every list
showed its empty state. The test copy has no such switch and always holds the
same seeded data: one business post (Fixture Mzansi Motor Workshop), two events
(Fixture Jozi Food Festival, Fixture Soweto Craft Market), no marketplace post,
solid-colour cover pictures, and the foundation price catalogue.

The only seeded value that changes from run to run is the event date: the seed
starts each event one minute before it runs, so event cards show the day of the
run ("WED 11 NOV"). That one line of each event card is masked (magenta block)
on `home` and `tourism-events`; the spec fails if the mask stops matching. No
other region is masked.

## Determinism

Three runs, each on a freshly deleted and re-seeded copy (`reset`), with no
retries: 33 of 33 matched every time (0 differ, 0 flaky; 113, 140 and 121 s
of browser time). A fourth fresh copy that rewrote every picture gave 28
pictures pixel-identical to the committed ones; the other 5
differed in 19 to 73 pixels by at most 6 of 255 in one colour channel (soft
gradients and shadows), the rendering noise the allowance exists for.

## Old (stub) and new (foundation) pictures, screen by screen

Compared pixel by pixel; "identical" means no channel differs by more than 1
of 255. Where the size differs, rows were aligned to find what was added or
removed.

| Screen          | Widths              | Old vs new                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cause      |
| --------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| home            | 375, 800, 1280, dark | Hero carousel shows the three seeded posts instead of the "Welcome to VerifyMzansi" placeholder card. Tourism & Events rail shows the two event cards (date masked) instead of "No stays or events yet"; Mzansi Business rail shows the workshop card instead of "No businesses yet". Mzansi Market keeps its empty state. Page 250-490 px taller. Header, market section, "Know who you're dealing with", steps and footer unchanged; below the taller rails some edges sit 1 px differently (layout rounding of the new heights). | Data       |
| mzansi-business | 375, 800, 1280      | Hero shows the workshop card instead of the placeholder; grid shows "1 business found" and the card instead of "No businesses yet". The right-edge filter tab (phones, tablets) moves with the page height, as the spec describes. Header, tabs, heading and footer unchanged.                                                                                                                                                                                              | Data       |
| tourism-events  | 375, 800, 1280      | Hero shows the event cards instead of the placeholder; "2 listings found" and two event cards (date masked) instead of "0 listings found" and "Nothing matches your filters". Filter tab moves with page height. Filters panel, tabs, heading and footer unchanged.                                                                                                                                                                                                       | Data       |
| pricing         | 375, 800, 1280, dark | Everything above the plan cards is identical. The 90- and 180-day plan cards lose "Save R10 / Save R50 vs. 30-day plans": the line shows only when a plan has a compare-at price, and the foundation catalogue has none (`compare_at_cents` is null). Each multi-listing tile gains "Choose 90 days / Choose 180 days" buttons: they show when a plan has a purchasable id, which the foundation catalogue provides and the stub's fallback catalogue did not. The rest of the page and the footer are unchanged, shifted by the changed heights. | Data       |
| mzansi-market   | 375, 800, 1280      | Identical (no marketplace post is seeded, so the empty state is the same).                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| post-not-found  | 375, 800, 1280      | Identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| login           | 375, 800, 1280, dark | Identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| register        | 375, 800, 1280      | Identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| contact         | 375, 800, 1280      | Identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None       |
| trust-safety    | 375, 800, 1280      | Identical.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | None       |

19 of 33 pictures are identical. The other 14 differ only where the seeded data
differs from the stub's hidden data. **No layout or style difference was found
that the data does not explain.**

## For the owner

- Pricing: production's catalogue has no compare-at prices, so live visitors do
  not see the "Save R10 / R50 vs. 30-day plans" lines that the chosen frontend
  shows with its built-in catalogue. This is a data decision, not a screen
  change; record compare-at prices in the foundation catalogue if those lines
  should appear.
- The footer shows the current year ("© 2026"), as the old pictures did: on
  1 January every picture with the footer will differ and needs an approved
  refresh. Not masked here, to keep the screens as they were.
- The old pictures (`e2e/visual-regression.spec.ts-snapshots/`) and spec stay
  until the stub suite is removed in its own change; CI no longer runs them.
