/**
 * Node.js version guard — fails fast if running on an unsupported version.
 * Run this before any other script to catch toolchain drift early.
 */

const MIN_MAJOR = 20;
const MAX_MAJOR = 25; // Support Node 20 LTS through Node 25

const raw = process.version; // e.g. "v20.11.1"
const match = raw.match(/^v(\d+)\./);
if (!match) {
  console.error(`❌ Unable to parse Node.js version from "${raw}".`);
  process.exit(1);
}

const major = Number(match[1]);
if (major < MIN_MAJOR || major > MAX_MAJOR) {
  console.error(
    [
      `❌ Unsupported Node.js version: ${raw}`,
      `   This project requires Node.js ${MIN_MAJOR}.x – ${MAX_MAJOR}.x.`,
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
