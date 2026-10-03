import { createRequire } from "module";
const require = createRequire(import.meta.url);

const nextConfig = require("eslint-config-next");
const tseslint = require("typescript-eslint");
const security = require("eslint-plugin-security");

const eslintConfig = [
  ...nextConfig,
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
];

export default eslintConfig;
