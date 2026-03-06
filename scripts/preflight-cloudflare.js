#!/usr/bin/env node
/**
 * preflight-cloudflare.js
 *
 * Quick pre-check before running any OpenNext / Cloudflare build commands.
 * On native Windows (no WSL) the build will fail with:
 *   Error: EPERM: operation not permitted, symlink ...
 * because creating symlinks requires elevated privileges on Windows.
 *
 * This script detects the platform early and prints a clear error instead
 * of letting the build crash halfway through.
 *
 * 2026-03-01 — Confirmed: build must run from WSL 2 native ext4 filesystem
 *   (~/verifymzansi), NOT from /mnt/c/... NTFS mount. The NTFS mount causes
 *   EACCES rename errors during pnpm install and symlink failures during
 *   OpenNext bundling. Copy project with rsync then build from ~.
 */

const os = require("os");

function isWSL() {
  if (os.platform() !== "linux") return false;
  try {
    const release = os.release().toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

const platform = os.platform();

if (platform === "win32") {
  console.error(`
╔══════════════════════════════════════════════════════════════╗
║  ❌  Cloudflare build is not supported on native Windows    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  OpenNext creates symlinks during bundling, which requires   ║
║  elevated privileges on Windows and will fail with:          ║
║                                                              ║
║    EPERM: operation not permitted, symlink                   ║
║                                                              ║
║  Use one of these alternatives:                              ║
║                                                              ║
║  1. WSL 2 on an ext4 workspace (recommended):                ║
║     wsl -d Ubuntu                                            ║
║     rsync -a --delete /mnt/c/Users/.../verifymzansi/ ~/verifymzansi/ ║
║     cd ~/verifymzansi                                        ║
║     pnpm build:cloudflare                                    ║
║                                                              ║
║  2. Push to master and let GitHub Actions deploy on Ubuntu   ║
║                                                              ║
║  CI/CD deploys on ubuntu-latest — no action needed there.    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// On Linux/macOS/WSL — all good
if (isWSL()) {
  console.log("✓ Running in WSL — Cloudflare build is supported.");
} else if (platform === "darwin") {
  console.log("✓ Running on macOS — Cloudflare build is supported.");
} else {
  console.log(`✓ Running on ${platform} — Cloudflare build should work.`);
}
