/**
 * Node.js version guard — fails fast if running on an unsupported version.
 * Run this before any other script to catch toolchain drift early.
 */

const raw = process.version; // e.g. "v20.11.1"
const match = raw.match(/^v(\d+)\.(\d+)\./);
if (!match) {
  console.error(`❌ Unable to parse Node.js version from "${raw}".`);
  process.exit(1);
}

const major = Number(match[1]);
const minor = Number(match[2]);
if (!((major === 22 && minor >= 19) || major === 24)) {
  console.error(
    [
      `❌ Unsupported Node.js version: ${raw}`,
      "   This project requires Node.js 22.19+ (22.x) or 24.x.",
      "",
      "   Fix:",
      `   1. Install a supported Node version: https://nodejs.org/`,
      `   2. Or run: nvm install 22 && nvm use 22`,
      "",
    ].join("\n")
  );
  process.exit(1);
}

process.stdout.write(`✔ Node.js ${raw} (supported)\n`);
