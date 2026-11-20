# Mutation-testing trial

Launch checklist item 43 ("Deeper tests") asked for a trial of mutation testing
on a few small, critical modules. Mutation testing changes the code in small
ways (a `===` becomes `!==`, a condition becomes `true`, a string becomes empty)
and runs the tests against each change, or "mutant". A mutant the tests notice
is **killed**; one they do not notice **survived**, which points at behaviour no
test pins down.

The trial uses [StrykerJS](https://stryker-mutator.io/) 10.1.1 with its Vitest
runner. It is a local tool only: it is **not** part of CI or any required check.

## Running it

```bash
pnpm test:mutation
```

- Configuration: [stryker.config.mjs](../../stryker.config.mjs). The tests it
  runs are listed in
  [vitest.mutation.config.ts](../../vitest.mutation.config.ts), so a run takes
  minutes instead of the whole suite's time. How many depends on the machine:
  about two on a quiet one, about 15 on one busy with other work.
- Reports go to `tmp/mutation/` (`index.html` to browse, `mutation.json`), which
  Git ignores. Stryker works in a copy of the project under
  `tmp/stryker/sandbox-*` and removes it afterwards.
- **That copy links to the project's `node_modules`** (a junction on Windows, a
  symbolic link elsewhere). A finished run removes it; an interrupted one leaves
  it behind. Deleting the copy with a recursive delete that follows the link
  deletes the project's real `node_modules` too. Before deleting anything under
  `tmp/`, check for links first (on Windows,
  `Get-ChildItem tmp -Recurse -Attributes ReparsePoint`), and remove each link
  on its own (on Windows, `cmd /c rmdir <link>`, which removes only the link)
  before deleting the rest.

## Modules in the trial

| Module                                                                       | Why                                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [src/lib/foundation/person-name.ts](../../src/lib/foundation/person-name.ts) | The person-name rule for display and legal names (shared with the database). |
| [src/lib/utils/mutation-origin.ts](../../src/lib/utils/mutation-origin.ts)   | The origin check on every state-changing API route.                          |
| [src/lib/utils/csrf-client.ts](../../src/lib/utils/csrf-client.ts)           | The double-submit token: its format, cookie parsing and the page's fetch.    |
| [src/lib/foundation/limiter-key.ts](../../src/lib/foundation/limiter-key.ts) | Rate limiter keys for typed values such as email addresses.                  |

## Scores

Run on 20 November 2026 (280 mutants, about 1 minute 45 seconds with four
workers).

| Module               | First run | After new tests | Killed | Timed out | Survived | No coverage |
| -------------------- | --------: | --------------: | -----: | --------: | -------: | ----------: |
| `person-name.ts`     |    100.0% |          100.0% |     61 |         3 |        0 |           0 |
| `limiter-key.ts`     |    100.0% |          100.0% |     12 |         0 |        0 |           0 |
| `csrf-client.ts`     |     71.6% |           91.7% |    100 |         0 |        8 |           1 |
| `mutation-origin.ts` |     55.8% |           81.1% |     77 |         0 |       12 |           6 |
| **All four**         | **73.9%** |       **90.4%** |    250 |         3 |       20 |           7 |

A timed-out mutant (an endless loop in the name rule's search) counts as killed.

## Survivors that were worth a test

The first run left behaviour of the origin and token checks that no test pinned
down. Each now has a test, and the mutants are killed:

- **The token's format is anchored at both ends.** Removing `^` or `$` from the
  64-hex-digit pattern went unnoticed, because the property test compared the
  code with itself. It now uses an independent statement of the rule and
  generates valid tokens with text before or after them
  ([csrf.property.test.ts](../../src/lib/utils/csrf.property.test.ts)).
- **The configured site address and the address a request came to are both
  accepted, and nothing else.** Tests always used the same address for both, so
  either half of the check could be dropped. A property test now uses different
  addresses for the two.
- **Fetch metadata without an origin.** `same-origin` and `same-site` were never
  generated, so turning that branch off went unnoticed; the generator now
  includes them, and each decision is checked in full (status, message, reason).
- **What a refusal records.** The security event, its reason and the logged
  fields (path, origin, fetch metadata) were not checked.
- **The page's token request.** Its options (`cache: "no-store"`,
  `credentials: "same-origin"`), ignoring a token in a failed answer, adding no
  header when there is no token, and doing nothing during server rendering
  ([csrf-client.test.ts](../../src/lib/utils/csrf-client.test.ts),
  [csrf-client.server.test.ts](../../src/lib/utils/csrf-client.server.test.ts)).

## Survivors left as they are

The remaining 27 mutants cannot change what a caller sees:

- **Equivalent branches in the origin check.** The `sec-fetch-site: none` branch
  returns exactly what the final refusal returns, so removing or inverting it
  changes nothing (5 mutants). `safeOrigin`'s early return and its `catch` both
  end in "no origin" either way (2).
- **Unreachable defensive code.** The "unable to resolve application origin"
  refusal needs both the configured and the request address to be unparseable,
  which a real request cannot be (9 mutants, 6 of them without coverage).
- **Same value either way.** `request.nextUrl?.pathname ?? new URL(...)`
  produces the same path for every request object the routes pass (2).
- **Browser fallbacks with the same outcome.** `document.head` always exists in
  a page, a missing `fetch` ends in the same "no token" through the `catch`, and
  a non-string token in the answer is refused later by the format check anyway
  (9 in `csrf-client.ts`, 1 of them without coverage).

If the origin check is ever tidied up, the `none` branch and the unreachable
refusal could be removed without changing behaviour; that is a code change for
its own pull request, not part of this trial.

## Should it run in CI?

Not yet. Two minutes for four files is fine locally, but the scores depend on
which tests are listed in `vitest.mutation.config.ts`, and a required gate would
need a stable threshold per module. Running it before changing one of these
modules, and adding a module when it becomes security-relevant, gives most of
the value without slowing every pull request.
