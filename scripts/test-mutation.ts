import { createHash } from "node:crypto";
import { getRoleFromUser, isModeratorOrAdmin } from "../src/lib/auth/roles";
import {
  detectMimeFromMagicBytes,
  validateBufferIntegrity,
} from "../src/lib/utils/file-validation";
import { sanitizeReturnUrl } from "../src/lib/utils/navigation";
import { verifyPayFastSignature } from "../src/lib/services/payfast";

type Canary = {
  name: string;
  run: () => boolean;
};

function signPayFastPayload(data: Record<string, string>, passphrase: string): string {
  // Must match the PF_ITN_ORDER used by verifyPayFastSignature
  const PF_ITN_ORDER = [
    "m_payment_id",
    "pf_payment_id",
    "payment_status",
    "item_name",
    "item_description",
    "amount_gross",
    "amount_fee",
    "amount_net",
    "custom_str1",
    "custom_str2",
    "custom_str3",
    "custom_str4",
    "custom_str5",
    "custom_int1",
    "custom_int2",
    "custom_int3",
    "custom_int4",
    "custom_int5",
    "name_first",
    "name_last",
    "email_address",
    "merchant_id",
  ];
  const knownKeys = PF_ITN_ORDER.filter((key) => key in data);
  const extraKeys = Object.keys(data).filter((key) => !PF_ITN_ORDER.includes(key));
  const orderedKeys = [...knownKeys, ...extraKeys];

  const signatureString = orderedKeys
    .map((key) => `${key}=${encodeURIComponent(data[key].trim())}`)
    .join("&");
  return createHash("md5")
    .update(`${signatureString}&passphrase=${encodeURIComponent(passphrase)}`)
    .digest("hex");
}

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
  {
    name: "PayFast signature verifier fails on tampered amount",
    run: () => {
      const passphrase = "mutation-test-passphrase";
      const payload: Record<string, string> = {
        m_payment_id: "pay-canary-1",
        payment_status: "COMPLETE",
        amount_gross: "100.00",
      };
      const signature = signPayFastPayload(payload, passphrase);
      const valid = verifyPayFastSignature({ ...payload, signature }, passphrase);
      const tampered = verifyPayFastSignature(
        { ...payload, amount_gross: "999.99", signature },
        passphrase
      );
      return valid && !tampered;
    },
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
