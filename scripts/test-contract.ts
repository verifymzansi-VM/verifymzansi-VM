import fs from "node:fs";
import path from "node:path";
import {
  EmailProviderResponseSchema,
  KycWebhookPayloadSchema,
  PayFastItnPayloadSchema,
  SmsProviderResponseSchema,
} from "../src/test/contracts/webhooks";

type ContractCase = {
  name: string;
  file: string;
  validate: (value: unknown) => { success: boolean; error?: { message: string } };
};

const ROOT = path.join(process.cwd(), "src", "test", "fixtures", "contracts");

const CASES: ContractCase[] = [
  {
    name: "PayFast ITN complete",
    file: path.join("payfast", "itn.complete.json"),
    validate: (value) => PayFastItnPayloadSchema.safeParse(value),
  },
  {
    name: "PayFast ITN failed",
    file: path.join("payfast", "itn.failed.json"),
    validate: (value) => PayFastItnPayloadSchema.safeParse(value),
  },
  {
    name: "KYC webhook approved",
    file: path.join("kyc", "provider-approved.json"),
    validate: (value) => KycWebhookPayloadSchema.safeParse(value),
  },
  {
    name: "KYC webhook rejected",
    file: path.join("kyc", "provider-rejected.json"),
    validate: (value) => KycWebhookPayloadSchema.safeParse(value),
  },
  {
    name: "Africa's Talking success",
    file: path.join("sms", "africastalking-success.json"),
    validate: (value) => SmsProviderResponseSchema.safeParse(value),
  },
  {
    name: "Africa's Talking failure",
    file: path.join("sms", "africastalking-failure.json"),
    validate: (value) => SmsProviderResponseSchema.safeParse(value),
  },
  {
    name: "Resend success",
    file: path.join("email", "resend-success.json"),
    validate: (value) => EmailProviderResponseSchema.safeParse(value),
  },
  {
    name: "Resend error",
    file: path.join("email", "resend-error.json"),
    validate: (value) => EmailProviderResponseSchema.safeParse(value),
  },
];

function readJson(file: string): unknown {
  const fullPath = path.join(ROOT, file);
  return JSON.parse(fs.readFileSync(fullPath, "utf8")) as unknown;
}

async function main(): Promise<void> {
  console.log("Running provider/webhook contract validation...");

  const failures: string[] = [];

  for (const testCase of CASES) {
    const parsed = testCase.validate(readJson(testCase.file));
    if (!parsed.success) {
      failures.push(`${testCase.name}: ${parsed.error?.message ?? "invalid payload"}`);
      continue;
    }
    console.log(`  [OK] ${testCase.name}`);
  }

  // Negative checks to ensure schema strictness on critical fields.
  const invalidPayFast = readJson(path.join("payfast", "itn.complete.json")) as {
    signature?: string;
  };
  delete invalidPayFast.signature;
  if (PayFastItnPayloadSchema.safeParse(invalidPayFast).success) {
    failures.push("PayFast negative case: missing signature should fail");
  }

  const invalidKyc = readJson(path.join("kyc", "provider-approved.json")) as {
    status?: string;
  };
  invalidKyc.status = "unknown";
  if (KycWebhookPayloadSchema.safeParse(invalidKyc).success) {
    failures.push("KYC negative case: invalid status should fail");
  }

  const invalidSms = readJson(path.join("sms", "africastalking-success.json")) as {
    SMSMessageData?: { Recipients?: unknown[]; Message?: string };
  };
  invalidSms.SMSMessageData = { Message: "ok", Recipients: [] };
  if (SmsProviderResponseSchema.safeParse(invalidSms).success) {
    failures.push("SMS negative case: empty recipients should fail");
  }

  if (EmailProviderResponseSchema.safeParse({}).success) {
    failures.push("Email negative case: payload without data/error should fail");
  }

  if (failures.length > 0) {
    console.error("");
    console.error("Contract validation failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log("Contract validation passed.");
}

main().catch((error) => {
  console.error("Contract validation crashed:", error);
  process.exit(1);
});
