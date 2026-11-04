import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { handleFoundationOwnerRoute, foundationNoStore } from "@/lib/foundation/owner-route";
import {
  readFoundationAccountContext,
  FoundationAccountContextError,
} from "@/lib/foundation/account-context";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  FoundationPhoneError,
  issueFoundationPhoneChallenge,
  verifyFoundationPhoneChallenge,
} from "@/lib/foundation/phone-verification";
import {
  foundationPhoneSendSchema,
  foundationPhoneVerifySchema,
} from "@/lib/foundation/phone-verification-input";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { otpVerifySchema } from "@/lib/validations/auth";
import { saPhoneSchema } from "@/lib/validations/shared";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { z } from "zod";
import {
  FOUNDATION_PHONE_CHALLENGE_COOKIE,
  FOUNDATION_PHONE_CHALLENGE_PATH,
  sealPhoneChallenge,
  readPhoneChallenge,
} from "@/lib/foundation/phone-challenge-cookie";

const log = createLogger("FoundationPhone");
async function reserve(key: string, action: string) {
  const result = await checkRateLimit({ key, action, degradedMode: "block" });
  if (result.degraded || result.limited)
    throw new FoundationPhoneError(result.degraded ? 503 : 429);
}
export async function handleFoundationPhoneRoute(
  request: NextRequest,
  operation: "send" | "verify",
  restoredForm = false
) {
  if (process.env.FOUNDATION_PHONE_VERIFICATION_ENABLED !== "true")
    return Promise.resolve(
      NextResponse.json(
        { error: "Phone verification unavailable" },
        { status: 503, headers: foundationNoStore }
      )
    );
  let challengeCookie: string | undefined;
  const response = await handleFoundationOwnerRoute({
    request,
    log,
    action: operation === "send" ? "otp:send:ip" : "otp:verify",
    mutate: true,
    unavailableMessage: "Phone verification unavailable",
    signInMessage: "Sign in to verify your phone",
    async command(api, input) {
      let submittedPhone: string | undefined;
      if (restoredForm) {
        const original =
          operation === "send"
            ? z.strictObject({ phone: saPhoneSchema }).safeParse(input)
            : otpVerifySchema.strict().safeParse(input);
        if (!original.success) throw new FoundationPhoneError(400);
        submittedPhone = normalizeSaPhone(original.data.phone);
        if (operation === "send") input = { phone: submittedPhone };
      }
      // This identity is read from the live caller-bound SQL getter, never from
      // a submitted owner/user id or mutable Auth metadata.
      const account = await readFoundationAccountContext(api);
      if (restoredForm && operation === "verify") {
        const value = otpVerifySchema.parse(input);
        input = {
          challenge_id: readPhoneChallenge(
            request.cookies.get(FOUNDATION_PHONE_CHALLENGE_COOKIE)?.value,
            account.account_id,
            submittedPhone!
          ),
          code: value.otp,
        };
      }
      const parsed =
        operation === "send"
          ? foundationPhoneSendSchema.safeParse(input)
          : foundationPhoneVerifySchema.safeParse(input);
      if (!parsed.success) throw new FoundationPhoneError(400);
      await reserve(account.account_id, operation === "send" ? "otp:send:user" : "otp:verify:user");
      if (operation === "send") {
        const send = foundationPhoneSendSchema.parse(parsed.data);
        // Share the recipient bucket across accounts and networks, in addition
        // to the account bucket, to limit SMS pumping against a single phone.
        await reserve(send.phone, "otp:send");
        const challenge = await issueFoundationPhoneChallenge(
          createFoundationServiceApi(),
          account.account_id,
          send
        );
        if (!restoredForm) return challenge;
        challengeCookie = sealPhoneChallenge(
          account.account_id,
          send.phone,
          challenge.challenge_id,
          challenge.expires_at
        );
        return { success: true };
      }
      const verified = await verifyFoundationPhoneChallenge(
        createFoundationServiceApi(),
        account.account_id,
        parsed.data
      );
      return restoredForm ? { success: true, ...verified } : verified;
    },
    refusal(error) {
      const status =
        error instanceof FoundationPhoneError
          ? error.status
          : error instanceof FoundationAccountContextError && error.reason === "forbidden"
            ? 403
            : null;
      if (!status) return null;
      return {
        status,
        reason: status === 429 ? "phone_rate_limited" : "phone_verification_refused",
        error:
          status === 429
            ? "Too many attempts; try again later"
            : status === 400 || status === 409
              ? "Check the number or code, or request a new code"
              : "Phone verification could not be completed",
      };
    },
  });
  if (restoredForm && response.ok && (challengeCookie || operation === "verify"))
    response.cookies.set(FOUNDATION_PHONE_CHALLENGE_COOKIE, challengeCookie ?? "", {
      path: FOUNDATION_PHONE_CHALLENGE_PATH,
      httpOnly: true,
      sameSite: "strict",
      secure: request.nextUrl.protocol === "https:",
      maxAge: operation === "verify" ? 0 : 300,
    });
  return response;
}
