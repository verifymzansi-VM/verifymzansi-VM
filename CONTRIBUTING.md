# Contributing to VerifyMzansi

Thank you for your interest in contributing to VerifyMzansi! This document
provides guidelines and conventions for contributing to the project.

---

## Table of Contents

- [Getting Started](#getting-started)
  - [Platform Requirements](#platform-requirements)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Code Review Checklist](#code-review-checklist)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)
- [Architecture Decisions](#architecture-decisions)

---

## Getting Started

1. Clone the repository and follow the
   [Quick Start guide](README.md#quick-start)
2. Ensure all tests pass: `pnpm test`
3. Ensure linting passes: `pnpm lint`
4. Ensure type-checking passes: `pnpm typecheck`

### Platform Requirements

| Task                               | Windows | macOS / Linux | WSL 2 |
| ---------------------------------- | ------- | ------------- | ----- |
| `pnpm dev` (Turbopack)             | ✅      | ✅            | ✅    |
| `pnpm test` (Vitest)               | ✅      | ✅            | ✅    |
| `pnpm build` (Next.js)             | ✅      | ✅            | ✅    |
| `pnpm build:cloudflare` (OpenNext) | ❌      | ✅            | ✅    |

> **Windows users**: The Cloudflare build (`open-next build`) creates symlinks
> that require elevated privileges on native Windows. The build will fail with
> `EPERM: operation not permitted, symlink`. Use **WSL 2** for any Cloudflare
> build or deploy task. CI runs on Linux so this does not affect the pipeline.
>
> ```bash
> # From a WSL 2 shell:
> cd /mnt/c/Users/<you>/Documents/verifymzansi
> pnpm build:cloudflare   # works
> ```

> **Cloudflare warning triage**: The deploy pipeline currently accepts two
> warning classes as known noise on the supported stack: OpenNext Durable Object
> startup warnings from `wrangler.toml` and generated `duplicate-object-key`
> warnings from `.open-next/server-functions`. Treat new warning patterns as
> actionable until proven otherwise.

## Branch Naming

Use the following convention:

```
<type>/<short-description>
```

| Type        | Description               | Example                   |
| ----------- | ------------------------- | ------------------------- |
| `feat/`     | New feature               | `feat/i18n-support`       |
| `fix/`      | Bug fix                   | `fix/otp-rate-limit`      |
| `chore/`    | Maintenance / tooling     | `chore/update-deps`       |
| `docs/`     | Documentation only        | `docs/api-reference`      |
| `refactor/` | Code restructuring        | `refactor/kyc-engine`     |
| `test/`     | Test additions            | `test/e2e-auth-flows`     |
| `perf/`     | Performance improvement   | `perf/image-optimization` |
| `security/` | Security fix or hardening | `security/csp-nonce`      |

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/) (v1.0.0):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

### Types

| Type       | When to use                    |
| ---------- | ------------------------------ |
| `feat`     | A new feature                  |
| `fix`      | A bug fix                      |
| `docs`     | Documentation changes          |
| `style`    | Formatting (no code change)    |
| `refactor` | Restructuring (no feature/fix) |
| `perf`     | Performance improvement        |
| `test`     | Adding/updating tests          |
| `chore`    | Build, CI, or tooling changes  |
| `security` | Security improvements          |

### Examples

```
feat(marketplace): add search filters for location and price range
fix(otp): prevent rate-limit bypass on concurrent requests
docs(api): add OpenAPI spec for verification endpoints
chore(ci): add bundle size check to PR workflow
security(csp): implement nonce-based script policy
```

### Scope (optional but recommended)

Use the affected module: `auth`, `marketplace`, `kyc`, `admin`, `billing`,
`otp`, `api`, `ui`, `ci`, `db`, `workers`.

## Pull Request Process

1. **Create a feature branch** from `main` using the naming convention above
2. **Make your changes** with clear, atomic commits
3. **Ensure all checks pass locally:**
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm format:check
   ```
4. **Push and open a PR** against `main`
5. **Fill out the PR template** with description, screenshots (if UI), and
   testing notes
6. **Request review** from at least one team member
7. **Address feedback** with fixup commits or amendments
8. **Merge** via squash-and-merge after approval

### PR Title Format

Follow the same Conventional Commits format:

```
feat(marketplace): add location-based search
```

## Code Review Checklist

Reviewers should verify:

- [ ] **Functionality**: Does the code do what it claims?
- [ ] **Types**: No `any` types; proper type narrowing
- [ ] **Tests**: New code has corresponding tests; existing tests still pass
- [ ] **Security**: No secrets, proper input validation, auth checks in place
- [ ] **Accessibility**: Interactive elements have ARIA labels, keyboard support
- [ ] **Performance**: No unnecessary re-renders, large imports are dynamically
      loaded
- [ ] **Error handling**: Graceful failures with user-friendly messages
- [ ] **POPIA compliance**: Sensitive data is encrypted; audit logs for data
      access
- [ ] **Mobile-first**: UI works on 375px screens
- [ ] **Documentation**: JSDoc on exported functions; README updated if needed

## Testing Requirements

### New features must include:

- **Unit tests** (Vitest) for business logic in `src/lib/`
- **Component tests** (Testing Library) for interactive UI components
- **E2E tests** (Playwright) for critical user flows

### Coverage targets:

| Metric     | Target |
| ---------- | ------ |
| Statements | ≥ 80%  |
| Branches   | ≥ 75%  |
| Functions  | ≥ 80%  |
| Lines      | ≥ 80%  |

### Running tests:

```bash
pnpm test              # Unit tests
pnpm test:coverage     # With coverage report
pnpm test:e2e          # Playwright E2E
pnpm test:all          # Everything
```

## Code Style

- **Formatter**: Prettier (run `pnpm format` to auto-fix)
- **Linter**: ESLint with strict TypeScript rules
- **Language**: TypeScript (strict mode) — no `any` types
- **Imports**: Sorted by category (external → internal → relative)
- **Components**: Server Components by default; `"use client"` only when needed
- **Naming**:
  - Files: `kebab-case.ts` / `kebab-case.tsx`
  - Components: `PascalCase`
  - Functions/variables: `camelCase`
  - Constants: `SCREAMING_SNAKE_CASE`
  - Types/interfaces: `PascalCase`

## Architecture Decisions

Key decisions are documented in `docs/adr/`. When making significant
architectural choices, create a new ADR:

```
docs/adr/NNN-short-title.md
```

See existing ADRs for the template format.

---

Questions? Reach out to the team lead or open a discussion issue.
