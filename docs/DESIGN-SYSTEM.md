# VerifyMzansi Design System — "Mzansi Modern"

VerifyMzansi is South Africa's trust-first marketplace: **Mzansi Market** (buy &
sell), **Mzansi Business** (local businesses & services) and **Tourism &
Events** (stays, experiences, venues, live events). Every poster completes
identity review before they can post.

The interface should feel **modern, premium, trustworthy, social, clean, active
and proudly South African** — a social marketplace app, not a classifieds site
and not a security company.

## Principles

0. **Less text.** Say it in as few words as possible. One short line under a
   heading at most; prefer icons, images, badges and labels over paragraphs. Cut
   anything a visitor wouldn't miss.

1. **Explain first, then browse.** Every entry page answers: what is this, what
   can I find, why trust it, how do I start.
2. **Trust is visible but light.** Every poster is ID-reviewed, so feed cards
   carry **no** verification marks. The labelled `TrustBadge` appears only
   beside the poster's name on detail pages. Never imply a guarantee: badges
   describe _account checks_.
3. **Media-first, like TikTok and Facebook.** Clients' photos and video are the
   product. Pages open on the showroom; detail pages open on the media card,
   fully visible without scrolling. Keep text to a title, price and place.
4. **Mobile first.** 16px gutters (`container-page`), 44px minimum touch
   targets, bottom tab bar on discovery pages, sticky action bars on detail
   pages.
5. **South African, not flag-coloured.** The logo is the one place the flag
   appears — keep it exactly as is. Local imagery (showroom artwork), SA copy
   ("bakkies", "Mzansi"), a subtle Ndebele-inspired pattern (`.mzansi-pattern`),
   marigold sunshine accents.

## Colour

Scale names are stable (they are used across the codebase); the values are the
new palette.

| Token scale   | Role                                          | Key values                            |
| ------------- | --------------------------------------------- | ------------------------------------- |
| `brand-green` | **Verified Emerald** — primary, trust, Market | 600 `#0b7a55` (DEFAULT), 500, 700     |
| `brand-blue`  | **Ocean Indigo** — Mzansi Business            | 600 `#3450d8` (DEFAULT), 700 for text |
| `teal`        | **Coast Teal** — Tourism & Events             | 600 for tiles, 700/800 for text       |
| `sunset`      | **Sunset Coral** — warm accents               | 600 `#d9541a`, 700 `#b8420f` for text |
| `brand-gold`  | **Marigold** — highlights, Featured, Pro      | 400 `#f9a826` (DEFAULT)               |
| `brand-red`   | **Protea** — errors, Urgent, destructive      | 600 `#d63b22` (DEFAULT)               |
| `warm`        | **Stone** neutrals                            | 50–950                                |

Semantic CSS variables (`bg-background`, `bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-primary`, `ring-ring`…) are
defined for light and dark in `src/styles/globals.css`. Canvas is soft stone
(`#f7f7f4`) with white cards; dark mode is a deep green-black. **Always prefer
semantic tokens** (`bg-card`, `text-foreground`) over raw `slate-*`, `zinc-*`,
`gray-*`, `amber-*`, `teal-*`, `emerald-*` so dark mode works.

Text on white: use `-700` shades for coloured text (`text-brand-green-700`,
`text-sunset-700`, `text-brand-blue-700`) and `dark:` `-300` shades. Solid
buttons: `-600` background with white text.

Area identity helpers: `.area-market-tile`, `.area-business-tile`,
`.area-tourism-tile`.

## Typography

- Display: **Bricolage Grotesque** (`font-display`) — h1–h3, big numbers,
  section titles.
- Body/UI: **Plus Jakarta Sans** (`font-body`, default). Card titles use
  `font-body`.
- Page h1:
  `font-display text-[1.75rem] sm:text-[2.25rem] font-bold tracking-tight` (see
  `PageHeader`).
- Section heading pair: `.section-title` + `.section-lede`.
- Small eyebrow: `.section-kicker` (sentence-case pill). Use an eyebrow only
  when it carries information (e.g. which product area a rail belongs to) —
  never above every heading.
- Avoid filler headings ("The main details shoppers look for"); say what the
  section is.
- **Avoid template tells:** no tracked ALL-CAPS labels, no single-word colour
  accents in headlines, no `→` arrows appended to every button (reserve arrow
  icons for "See all"-style navigation links), no `A · B · C` meta strings where
  a simple list or line break reads better, no numbered markers unless the
  content really is a sequence (verification steps and posting steps are).

## Shape, depth, motion

- Radius: inputs/buttons `rounded-xl`; cards `rounded-2xl`/`rounded-3xl`; pills
  `rounded-full`.
- Elevation: `elev-xs … elev-xl` utilities (token-based, dark-mode aware).
- Surfaces: `.surface-card` (white card, hairline border), `.hero-panel`.
- Motion: 200–300ms ease-out. Motion should answer a user action (open, expand,
  confirm). At most one ambient animation per page (the showroom); always add
  `motion-reduce:animate-none`. No fade-up entrance on every section.

## Components

| Component                              | Use                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (`@/components/ui/button`)    | variants: default, `trust-verified` (primary emerald), `outline`, `ghost`, `ink` (dark neutral), `trust-gold`, `destructive`. Sizes sm/default/lg/xl.                       |
| `Badge`                                | adds `variant="verified"`.                                                                                                                                                  |
| `BrandLogo` (`shared/brand-logo`)      | **The owner's original logo artwork — never redraw or restyle it.** Default `tone="auto"` swaps to the original inverse file in dark mode; `tone="inverse"` on dark panels. |
| `BrandShield` / `BrandShieldAlert`     | The original shield artwork, used as an icon.                                                                                                                               |
| `TrustBadge` (`trust/trust-badge`)     | labelled trust tier pill (legal wording from `trust-scale`).                                                                                                                |
| `VerifiedTick` (`trust/verified-tick`) | compact emerald shield tick beside names; `decorative` when text already says it; `pro` for tier 4.                                                                         |
| `PageHeader` (`layout/page-header`)    | h1 + description + breadcrumbs + actions for secondary pages.                                                                                                               |
| `PosterCardShell` (`immersive`)        | **the one card shape**: full-bleed 9:16 media, title/price/place and logo overlaid at the bottom. Used by the showroom, home rails and every browse grid.                   |
| `ShowroomCardCarousel`                 | coverflow showroom that opens the homepage and each area page over the platform photo; the active card always fits the viewport.                                            |
| `HomeShowcaseShell`                    | a home rail: coloured area icon + area name + "View all". Only the three areas: Mzansi Market, Mzansi Business, Tourism & Events.                                           |
| `.pill-link`, `.chip`                  | quick-filter pills and meta chips.                                                                                                                                          |

Global chrome: sticky single-row `Header` (logo · area tabs · actions), dark
`Footer` with a post-for-free call-to-action band, and `MobileNav` tab bar (Home
· Search · Post · Verify · Account) on discovery pages only
(`shouldShowMobileNav`).

## States

- **Empty:** icon tile (`.empty-state-icon` or area tile) + one-line title +
  helpful sentence + one clear action. Compact, never a giant empty box.
- **Loading:** skeletons shaped like the final content (`Skeleton`,
  `.skeleton-shimmer`).
- **Error:** calm copy, what happened, what to do next, retry + home/contact
  links.

## Writing (UX copy)

- Verb-first, specific CTAs that name the outcome: "Post an item", "Send
  enquiry", "Add your business" — not "Submit" / "Click here". An action keeps
  its name through the flow.
- Errors: what happened + why (if known) + how to fix. Never vague, never
  blaming.
- Empty states: what this is + why it's empty + how to start (one action).
- Sentence case everywhere. Plain South African English; no jargon, no hype, no
  guarantees.

## Accessibility (WCAG 2.1 AA)

Contrast ≥ 4.5:1 for text (≥ 3:1 large text and UI parts); visible focus on
every interactive element; 44×44px touch targets; labels on every input; errors
tied to fields (`aria-describedby`); meaningful `alt` text (empty `alt=""` for
decorative images); one `h1` per page and a logical heading order; dialogs trap
and return focus; nothing depends on colour alone. The Playwright
`@axe-core/playwright` package is installed for automated checks
(`e2e/a11y.spec.ts`).

## Engineering rules

- Keep behaviour, data flow, API calls, `data-testid`s, `aria-label`s, form
  field names and route hrefs intact unless deliberately changing them (then
  update tests).
- **CSP blocks `data:` images** — serve decorative SVGs from `public/`.
- **No locale-dependent formatting in client components.** Use `formatZAR`,
  `formatZARShort`, `formatRandAmount`, `formatSaShortDate`, `formatSaLongDate`
  from `@/lib/utils/format` (they are identical on server and browser;
  `toLocaleString("en-ZA")` is not and causes hydration errors).
- Every page's `<main>` has `id="main-content"` (skip link target).
- Format with Prettier; `pnpm lint`, `pnpm typecheck` and the Vitest suite must
  stay green.
