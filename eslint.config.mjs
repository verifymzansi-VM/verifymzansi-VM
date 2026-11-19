import { createRequire } from "module";
const require = createRequire(import.meta.url);

const nextConfig = require("eslint-config-next");
const tseslint = require("typescript-eslint");
const security = require("eslint-plugin-security");
const { default: localRules } = await import("./scripts/eslint-rules/no-silent-error-handler.mjs");

// The only files allowed to use dangerouslySetInnerHTML: each writes inline
// JSON-LD (with "</" escaped) or a fixed bootstrap script or style from a
// constant. Any other use is a lint error until it is reviewed and added here.
// Each entry pins how many times the file names it (the rule ignores the file
// as a whole, so a second use there must be reviewed too).
// scripts/dangerous-html-allowlist.test.mjs keeps these counts equal to the
// uses in code anywhere in the repository.
export const DANGEROUS_HTML_USES = {
  "src/app/(marketplace)/_lib/promotion-detail-page-content.tsx": 1,
  "src/app/(marketplace)/mzansi-business/page.tsx": 1,
  "src/app/(marketplace)/mzansi-market/page.tsx": 1,
  "src/app/(marketplace)/promotions/page.tsx": 1,
  "src/app/layout.tsx": 6,
  "src/app/listing/[id]/page.tsx": 1,
  "src/app/organisation/[slug]/page.tsx": 1,
  "src/app/page.tsx": 1,
  "src/app/pricing/page.tsx": 1,
};
export const DANGEROUS_HTML_ALLOWLIST = Object.keys(DANGEROUS_HTML_USES);

// Flat-config file patterns are globs: match brackets and parentheses literally.
const literalGlob = (file) => file.replace(/[[\]()]/g, (char) => `\\${char}`);

const DANGEROUS_HTML_MESSAGE =
  "dangerouslySetInnerHTML is allowed only in the reviewed files listed in DANGEROUS_HTML_ALLOWLIST (eslint.config.mjs).";

const eslintConfig = [
  ...nextConfig,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: DANGEROUS_HTML_ALLOWLIST.map(literalGlob),
    rules: {
      "no-restricted-syntax": [
        "error",
        // <div dangerouslySetInnerHTML={...} />
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: DANGEROUS_HTML_MESSAGE,
        },
        // createElement("div", { dangerouslySetInnerHTML: ... }) and spread props.
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: DANGEROUS_HTML_MESSAGE,
        },
        {
          selector: "Property[key.value='dangerouslySetInnerHTML']",
          message: DANGEROUS_HTML_MESSAGE,
        },
      ],
    },
  },
  {
    files: ["**/*.{tsx,jsx}"],
    rules: {
      // React best practices
      "react/no-unescaped-entities": "off",

      // Accessibility — errors so CI enforces a11y
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/interactive-supports-focus": "error",
    },
  },
  {
    files: ["src/app/opengraph-image.tsx"],
    rules: {
      // ImageResponse renders an image, and Next's metadata exemption has a
      // platform-dependent path check. Keep this narrow exemption consistent.
      "@next/next/no-img-element": "off",
    },
  },
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      security,
    },
    rules: {
      // Console hygiene
      "no-console": ["error", { allow: ["warn", "error"] }],

      // Import hygiene
      "no-duplicate-imports": "error",

      // High-signal security checks; these also run in CI through pnpm lint.
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-bidi-characters": "error",
      "security/detect-non-literal-require": "error",
    },
  },
  {
    files: ["scripts/**/*.{ts,js,mjs,cjs}", "workers/**/*.ts"],
    rules: {
      // CLI diagnostics and worker observability are part of their interfaces.
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Server code must not swallow failures silently: a handler logs, rethrows,
    // returns something the caller checks, or carries a comment saying why
    // ignoring the error is safe. Modules marked "use client" are skipped.
    files: ["src/app/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}", "workers/**/*.ts"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__tests__/**"],
    plugins: { local: localRules },
    rules: {
      "local/no-silent-error-handler": "error",
    },
  },
];

export default eslintConfig;
