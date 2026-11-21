# Limits register

`docs/testing/limits-register.json` lists every limit the system enforces: rate
and flood limits, quotas, caps on counts and money, size and length limits,
batch and page sizes, attempt counts and a few expiry windows. Each entry says
what the limit is, its value, where it is enforced and which test proves it.

`node scripts/check-limits-register.mjs` (CI job `foundation-replay`, after the
schema snapshot is regenerated) fails when the register and the code disagree.
`--list` also prints every limit with its current `file:line`.

## Entry fields

| Field        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | `LIM-<AREA>-<name>`: `SQL` (curated database limits), `F` (other database guard lines), `T` (table CHECK constraints, named after the constraint), `RL` (shared rate limiter), `APP` (website and worker), `MECH` (a shared mechanism other entries rely on).                                                                                                                                                                                                                |
| `title`      | The limit in plain words.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `value`      | The limit's value (and `unit` when it is not a count). `RL` entries also carry `tiers` (`limit` per `ttl` seconds), which the rate-limiter test compares with the worker.                                                                                                                                                                                                                                                                                                    |
| `category`   | `rate`, `quota`, `cap`, `money`, `size`, `length`, `batch`, `retention`, `expiry`, `attempts`, `range` or `mechanism`.                                                                                                                                                                                                                                                                                                                                                       |
| `enforcedAt` | One or more `{ file, contains, symbol? }`. `contains` is the exact text that enforces the limit, value included, so changing the value without updating the register fails the check. Database anchors point at the generated snapshot in `database/foundation/current`. Exception: an `RL` anchor only locates the action (`"auth:login": [`); its values are the entry's `tiers`, which the rate-limiter test compares with the worker, so a changed tier fails that test. |
| `tests`      | One or more `{ kind, file }` or `{ kind: "declaration", mechanism }`.                                                                                                                                                                                                                                                                                                                                                                                                        |

## Test kinds

- `behaviour`: the test exercises the limit at or past its bound. The test file
  must contain the entry's id.
- `register`: a register-driven test reads the register and checks every entry
  of its kind: `src/__tests__/limits/rate-limiter-limits.test.ts` (every limiter
  action and tier, one request below and at each limit) and
  `scripts/limits-sql.test.mjs` (every table CHECK constraint present, validated
  and exactly as registered, with boundary probes for simple length and number
  ranges).
- `declaration` with a tested mechanism: a value the code declares that a
  behaviour-tested mechanism enforces: a `privacy_text` length rule
  (`LIM-MECH-PRIVACY-TEXT`), a route body cap (`LIM-MECH-BODY-READER`), or a
  browser pre-check that mirrors a tested server limit. This proves the value is
  in force and the mechanism works, not each caller's behaviour at the bound.
- `declaration` with `LIM-MECH-SQL-GUARD` only: **present, not
  behaviour-tested.** The check proves the guard line, value included, is in the
  snapshot, and `scripts/limits-sql.test.mjs` proves it is in the replayed
  function body. Nothing exercises the limit at its bound. These entries are the
  behaviour-test backlog; the check prints their count on every run, and moving
  one to a behaviour test means adding the test and replacing its `tests` item.

Every website and worker limit has a behaviour test. Route body caps are checked
in `src/__tests__/limits/route-body-limits.test.ts`: one table, with a row per
route (id, cap, handler), that sends each real route a body of exactly the cap
and one byte more and checks the larger one is refused before any database call.
A new `maxBytes` route gets a row there. Browser pre-checks are tested next to
their page or component.

Behaviour tests for database limits run on the replayed production schema
(embedded Postgres, part of `pnpm test:tooling`; set-up in
`scripts/lib/limits-sql-harness.mjs`) or in the Docker suites named in the
register:

- `scripts/limits-sql.test.mjs`: the register-driven checks and the curated
  `LIM-SQL` limits;
- `scripts/limits-sql-bounds.test.mjs`: one table with a row per input limit of
  a command (a page size, a batch size, a length, a size, the number of ids in a
  list), called through the production API as the role that uses it: each value
  at the bound passes the guard (the call succeeds, or fails later with the
  named different error) and each value past it is refused with the guard's
  error. Below the table, limits on what is already stored (counts in a window,
  delivery attempts and back-off, allowances) and read caps (a read returns at
  most N rows when N + 1 exist), each with its fixtures. A new database guard on
  a command's input gets a row there.

The database entries still marked `LIM-MECH-SQL-GUARD` need a fixture this lane
does not have yet: a claimed identity, CIPC or visit case; the Multi-listing
package world (packages on sale, a verified buyer, payments over time), which
the Docker package suites exercise; refund sends; or a read cap over a table
with many required links.

## Adding or changing a limit

1. Change the code or add the database update as usual.
2. Run `pnpm db:foundation:snapshot` for database changes, then
   `node scripts/check-limits-register.mjs`.
3. Add or update the register entry and its test in the same pull request. A
   line the scanner flags that is not a limit goes in `notLimits` with a reason.

## What the scanner looks at, and what it cannot catch

The check scans:

- `database/foundation/current/functions`: lines that compare with, or bound
  between, an integer of 2 or more, `privacy_text(value, min, max)` length
  rules, `limit N` read caps, `:= N` constants (such as an allowance assigned to
  a variable) and integers inside `least(...)` / `greatest(...)`;
- `database/foundation/current/tables`: CHECK constraints with such a bound;
- `workers/rate-limiter.ts`: every `ACTION_LIMITS` action and the phone-code
  tiers;
- `src` and `workers` outside tests: `maxBytes: N` body caps and `*BYTES` /
  `*SIZE` number constants.

It does not find:

- time windows written as `interval '…'` (retention periods, expiry, cooldowns,
  the windows of rate limits). The register lists the most important ones by
  hand; others are only reviewed when their function changes;
- database limits in other forms: a number reaching a comparison through a
  variable set elsewhere, a computed value (`2 * ...`), arrays of allowed values
  (`in (30, 90, 180)`), or numbers inside string literals;
- limits written as plain literals without a size-like name, for example
  `file.size > 2 * 1024 * 1024`, `MAX_VIDEO_SECONDS = 120`, or `.max(n)` in
  request schemas (zod field lengths), and constants in other naming styles;
- values stored as data rather than code, such as plan and package rows, cost
  allowances (the SMS daily limit is registered by hand) and feature flags;
- limits in Supabase, Cloudflare or provider settings outside the repository.

A finding is covered when a register anchor in the same file is part of its line
and names every limit number on that line, so a short anchor (such as
`maxBytes: 4096`) cannot also cover a different number added to the same line or
file. A guard that spans several lines is anchored on the line holding the
number.
