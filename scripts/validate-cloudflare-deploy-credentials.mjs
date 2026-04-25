const REQUIRED_SECRETS = [
  {
    name: "CLOUDFLARE_API_TOKEN",
    value: process.env.CLOUDFLARE_API_TOKEN,
    pattern: /^[\x21-\x7e]+$/,
    formatHint:
      "It must be the raw Cloudflare API token only, with no labels, emoji, quotes, spaces, or newlines.",
  },
  {
    name: "CLOUDFLARE_ACCOUNT_ID",
    value: process.env.CLOUDFLARE_ACCOUNT_ID,
    pattern: /^[a-f0-9]{32}$/i,
    formatHint: "It must be the 32-character hexadecimal Cloudflare account ID.",
  },
];

const KNOWN_NON_ASCII_HINTS = new Map([
  [0x09, "This is a tab; use the raw value without surrounding whitespace."],
  [0x0a, "This is a newline; use a single-line secret value."],
  [0x0d, "This is a carriage return; use a single-line secret value."],
  [0x20, "This is a space; use the raw value without surrounding whitespace."],
  [
    0x26c5,
    "This is U+26C5, commonly rendered as a cloud/sun emoji; remove any copied label or decorative prefix.",
  ],
  [0x201c, "This is a left smart quote; use the raw value without quotes."],
  [0x201d, "This is a right smart quote; use the raw value without quotes."],
  [0x2018, "This is a left smart quote; use the raw value without quotes."],
  [0x2019, "This is a right smart quote; use the raw value without quotes."],
]);

let failed = false;

for (const secret of REQUIRED_SECRETS) {
  if (!secret.value) {
    console.error(`::error::${secret.name} is required for Cloudflare deploys.`);
    failed = true;
    continue;
  }

  const invalidCharacters = findInvalidCharacters(secret.value);
  if (invalidCharacters.length > 0) {
    const details = invalidCharacters
      .map((invalid) => {
        const codePoint = `U+${invalid.code.toString(16).toUpperCase().padStart(4, "0")}`;
        return `index ${invalid.index} (${codePoint}, decimal ${invalid.code})`;
      })
      .join("; ");
    const hints = [
      ...new Set(
        invalidCharacters.map((invalid) => KNOWN_NON_ASCII_HINTS.get(invalid.code)).filter(Boolean)
      ),
    ];
    console.error(
      `::error::${secret.name} contains invalid character(s): ${details}. ${hints.join(" ") || secret.formatHint}`
    );
    failed = true;
    continue;
  }

  if (!secret.pattern.test(secret.value)) {
    console.error(`::error::${secret.name} has an invalid format. ${secret.formatHint}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

function findInvalidCharacters(value) {
  const invalidCharacters = [];

  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index);

    if (code === undefined) {
      continue;
    }

    if (code < 0x21 || code > 0x7e) {
      invalidCharacters.push({ index, code });
      if (invalidCharacters.length >= 3) {
        break;
      }
    }

    if (code > 0xffff) {
      index += 1;
    }
  }

  return invalidCharacters;
}
