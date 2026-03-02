import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";

const log = createLogger("PayFast");

/**
 * PayFast checkout URL builder for South African payments (ZAR).
 */

interface PayFastCheckoutParams {
  merchantId: string;
  merchantKey: string;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  paymentId: string;
  amount: number;
  itemName: string;
  itemDescription?: string;
  emailAddress?: string;
  cellNumber?: string;
}

export function buildPayFastCheckoutUrl(params: PayFastCheckoutParams): string {
  // Validate amount to prevent invalid payment requests
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("PayFast amount must be a positive finite number");
  }

  const baseUrl =
    env("NODE_ENV") === "development"
      ? `${env("NEXT_PUBLIC_APP_URL")}/api/mock-payfast`
      : env("PAYFAST_SANDBOX") === "true"
        ? "https://sandbox.payfast.co.za/eng/process"
        : "https://www.payfast.co.za/eng/process";

  const pfData: Record<string, string> = {
    merchant_id: params.merchantId,
    merchant_key: params.merchantKey,
    return_url: params.returnUrl,
    cancel_url: params.cancelUrl,
    notify_url: params.notifyUrl,
    m_payment_id: params.paymentId,
    amount: params.amount.toFixed(2),
    item_name: params.itemName.slice(0, 100),
  };

  if (params.itemDescription) {
    pfData.item_description = params.itemDescription.slice(0, 255);
  }
  if (params.emailAddress) {
    pfData.email_address = params.emailAddress;
  }
  if (params.cellNumber) {
    pfData.cell_number = params.cellNumber;
  }

  // Generate signature in PayFast's required submission order
  const orderedKeys = [
    "merchant_id",
    "merchant_key",
    "return_url",
    "cancel_url",
    "notify_url",
    "m_payment_id",
    "amount",
    "item_name",
    "item_description",
    "email_address",
    "cell_number",
  ].filter((key) => key in pfData);

  const signatureString = orderedKeys
    .map((key) => `${key}=${encodeURIComponent(pfData[key].trim())}`)
    .join("&");

  // Add MD5 signature with passphrase
  const passphrase = env("PAYFAST_PASSPHRASE");
  const signatureData = passphrase
    ? `${signatureString}&passphrase=${encodeURIComponent(passphrase.trim())}`
    : signatureString;

  pfData.signature = crypto.createHash("md5").update(signatureData).digest("hex");

  const queryString = orderedKeys
    .concat("signature")
    .map((key) => `${key}=${encodeURIComponent(pfData[key])}`)
    .join("&");

  return `${baseUrl}?${queryString}`;
}

/**
 * Verify PayFast ITN signature.
 */
export function verifyPayFastSignature(data: Record<string, string>, passphrase?: string): boolean {
  // Safety: never allow sandbox mode in production
  if (env("PAYFAST_SANDBOX") === "true" && env("NODE_ENV") === "production") {
    throw new Error(
      "PAYFAST_SANDBOX=true is not allowed in production. This is a configuration error."
    );
  }

  if (
    env("NODE_ENV") === "development" &&
    env("PAYFAST_SANDBOX") === "true" &&
    data.signature === "mock_signature_skipped_in_dev"
  ) {
    // MD5 is PayFast-mandated (accepted business risk). Mock signature only in dev+sandbox.
    log.warn("Mock signature accepted — dev+sandbox mode only");
    return true;
  }

  const receivedSignature = data.signature;
  if (!receivedSignature) return false;

  const params = { ...data };
  delete params.signature;

  // Build signature string using PayFast's documented ITN parameter order.
  // Per PayFast docs, the signature must use the order parameters are received,
  // which follows their fixed submission order.
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

  // Use known order for standard fields, append any extras in received order
  const knownKeys = PF_ITN_ORDER.filter((key) => key in params);
  const extraKeys = Object.keys(params).filter((key) => !PF_ITN_ORDER.includes(key));
  const orderedKeys = [...knownKeys, ...extraKeys];

  const signatureString = orderedKeys
    .map((key) => `${key}=${encodeURIComponent(params[key].trim())}`)
    .join("&");

  // Add passphrase if provided
  const signatureData = passphrase
    ? `${signatureString}&passphrase=${encodeURIComponent(passphrase.trim())}`
    : signatureString;

  // Generate expected signature
  const expectedSignature = crypto.createHash("md5").update(signatureData).digest("hex");

  // Use timing-safe comparison to prevent side-channel attacks
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  const receivedBuf = Buffer.from(receivedSignature, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Verify source IP is from PayFast.
 */
const PAYFAST_IPS = [
  "197.97.145.144",
  "197.97.145.145",
  "197.97.145.146",
  "197.97.145.147",
  "197.97.145.148",
  "197.97.145.149",
  "197.97.145.150",
  "197.97.145.151",
];

export function isPayFastIp(ip: string): boolean {
  if (env("NODE_ENV") !== "production" && env("PAYFAST_SANDBOX") === "true") return true;
  return PAYFAST_IPS.includes(ip);
}
