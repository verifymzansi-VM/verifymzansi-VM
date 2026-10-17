import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { isUnder18FromSaId, validateSaIdChecksum } from "@/lib/utils/sa-id-validation";
import { sourceIdentityDigestToFingerprint } from "./identity-fingerprint";

export interface IdentityProcessingKeys {
  identityMatchKey: string;
  numberEncryptionKey: string;
  identityKeyId: "identity-match-v1";
  encryptionKeyId: "identity-number-v1";
}

function keyBytes(value: string): Buffer {
  if (!/^[a-f0-9]{64}$/.test(value) || new Set(value).size < 8) {
    throw new Error("Valid identity processing key required");
  }
  return Buffer.from(value, "hex");
}

/** Server processing primitive; no environment loading, logging or approval.
 * The authenticated adapter must supply the server-derived subject and keyring.
 * Staff still attest that this exact number matches the document/person.
 */
export function processIdentityNumber(
  ownerId: string,
  number: string,
  keys: IdentityProcessingKeys
) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(ownerId)) {
    throw new Error("Valid identity subject required");
  }
  if (
    typeof number !== "string" ||
    !/^[0-9]{13}$/.test(number) ||
    !validateSaIdChecksum(number) ||
    isUnder18FromSaId(number) !== false
  ) {
    throw new Error("Valid adult identity input required");
  }
  if (keys.identityKeyId !== "identity-match-v1" || keys.encryptionKeyId !== "identity-number-v1") {
    throw new Error("Unsupported identity key protocol");
  }
  const matching = keyBytes(keys.identityMatchKey);
  const encryption = keyBytes(keys.numberEncryptionKey);
  if (matching.equals(encryption)) throw new Error("Separate identity key purposes required");
  const digest = createHmac("sha256", matching).update(number, "utf8").digest("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryption, iv);
  cipher.setAAD(Buffer.from(`${ownerId}:id_doc`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(number, "utf8"), cipher.final()]);
  return {
    fingerprint: sourceIdentityDigestToFingerprint(digest),
    identityKeyId: keys.identityKeyId,
    encryptedNumber: {
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      key_id: keys.encryptionKeyId,
    },
  };
}
