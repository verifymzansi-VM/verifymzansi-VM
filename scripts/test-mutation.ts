import { getRoleFromUser, isModeratorOrAdmin } from "../src/lib/auth/roles";
import {
  detectMimeFromMagicBytes,
  validateBufferIntegrity,
} from "../src/lib/utils/file-validation";
import { sanitizeReturnUrl } from "../src/lib/utils/navigation";

type Canary = {
  name: string;
  run: () => boolean;
};

const canaries: Canary[] = [
  {
    name: "navigation blocks open redirect payloads",
    run: () =>
      sanitizeReturnUrl("https://evil.example/path") === "/dashboard" &&
      sanitizeReturnUrl("//evil.example/path") === "/dashboard",
  },
  {
    name: "file MIME detection rejects unknown magic bytes",
    run: () => detectMimeFromMagicBytes(new Uint8Array(16)) === null,
  },
  {
    name: "buffer integrity catches mismatched MIME type",
    run: () => {
      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const result = validateBufferIntegrity(jpegBytes, "image/png");
      return result.valid === false && result.mismatch === true;
    },
  },
  {
    name: "RBAC role extraction relies on app_metadata",
    run: () =>
      getRoleFromUser({ app_metadata: { role: "admin" } } as never) === "admin" &&
      isModeratorOrAdmin({ app_metadata: { role: "moderator" } } as never) &&
      !isModeratorOrAdmin({ app_metadata: { role: "member" } } as never),
  },
];

async function main(): Promise<void> {
  process.stdout.write("Running mutation canary checks...\n");

  const failed: string[] = [];
  for (const canary of canaries) {
    const ok = canary.run();
    if (!ok) {
      failed.push(canary.name);
      continue;
    }
    process.stdout.write(`  [OK] ${canary.name}\n`);
  }

  if (failed.length > 0) {
    console.error("Mutation canary checks failed:");
    for (const name of failed) {
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }

  process.stdout.write("Mutation canary checks passed.\n");
}

main().catch((error) => {
  console.error("Mutation canary run crashed:", error);
  process.exit(1);
});
