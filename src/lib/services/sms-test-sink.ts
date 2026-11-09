import { isPlaywrightFoundationCopy } from "@/lib/supabase/playwright-mode";

/** Where the local foundation test copy (roadmap M0.7) keeps the SMS it would
 * have sent, one JSON line per message, so browser tests can read a code. */
export const TEST_SMS_SINK_PATH = ["tmp", "foundation-e2e", "sms-sink.jsonl"] as const;

/**
 * Fake SMS sink for the local foundation test copy only. Called from the e2e
 * mock branch of sendSms, which already never contacts the SMS provider. It
 * writes nothing unless isPlaywrightFoundationCopy() holds, which production
 * can never satisfy (ENVIRONMENT=production and the London project ref).
 */
export async function recordTestSms(to: string, message: string): Promise<boolean> {
  if (!isPlaywrightFoundationCopy()) return false;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.resolve(process.cwd(), ...TEST_SMS_SINK_PATH);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify({ to, message, at: new Date().toISOString() })}\n`);
    return true;
  } catch {
    return false;
  }
}
