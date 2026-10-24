import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { handleFoundationOwnerRoute, foundationNoStore } from "../../_lib/owner-route";
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

const log = createLogger("FoundationPhone");
async function reserve(key: string, action: string) {
  const result = await checkRateLimit({ key, action, degradedMode: "block" });
  if (result.limited) throw new FoundationPhoneError(result.degraded ? 503 : 429);
}
export function handleFoundationPhoneRoute(request: NextRequest, operation: "send" | "verify") {
  if (process.env.FOUNDATION_PHONE_VERIFICATION_ENABLED !== "true")
    return Promise.resolve(
      NextResponse.json(
        { error: "Phone verification unavailable" },
        { status: 503, headers: foundationNoStore }
      )
    );
  return handleFoundationOwnerRoute({
    request,
    log,
    action: operation === "send" ? "otp:send:ip" : "otp:verify",
    mutate: true,
    unavailableMessage: "Phone verification unavailable",
    signInMessage: "Sign in to verify your phone",
    async command(api, input) {
      const parsed =
        operation === "send"
          ? foundationPhoneSendSchema.safeParse(input)
          : foundationPhoneVerifySchema.safeParse(input);
      if (!parsed.success) throw new FoundationPhoneError(400);
      // This identity is read from the live caller-bound SQL getter, never from
      // a submitted owner/user id or mutable Auth metadata.
      const account = await readFoundationAccountContext(api);
      await reserve(account.account_id, operation === "send" ? "otp:send:user" : "otp:verify:user");
      if (operation === "send") {
        const send = foundationPhoneSendSchema.parse(parsed.data);
        // Share the recipient bucket across accounts and networks, in addition
        // to the account bucket, to limit SMS pumping against a single phone.
        await reserve(send.phone, "otp:send");
        return issueFoundationPhoneChallenge(
          createFoundationServiceApi(),
          account.account_id,
          send
        );
      }
      return verifyFoundationPhoneChallenge(
        createFoundationServiceApi(),
        account.account_id,
        parsed.data
      );
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
}
