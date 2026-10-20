import { createHmac } from "node:crypto";

// Test-fixture use only. Seeds and codes must never enter evidence output.
export function nativeTotp(secret, epochMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]{16,128}$/.test(normalized) || !Number.isFinite(epochMs) || epochMs < 0)
    throw new Error("Invalid synthetic TOTP input");
  let bits = "";
  for (const character of normalized)
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(epochMs / 30000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
