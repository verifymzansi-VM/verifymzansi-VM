import "server-only";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "./staff-command";
import { createFoundationServiceApi } from "./service-api";
import { currentBusinessClaim, readMyBusinessChecks } from "./business-seen";
import { hashCode, isWorkEmail, newCode } from "../business-verification/representative";
import { sendWorkEmailCode } from "../services/email";
import { createLogger } from "../utils/logger";

const log = createLogger("NativeCipcCommands");
type OwnerAction = "renew" | "link" | "route-switch" | "office-visibility" | "work-email";
const requestCode = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("send"),
    caseId: z.uuid(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    position: z.string().trim().min(2).max(40),
  }),
  z.strictObject({
    action: z.literal("verify"),
    caseId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
]);

export function handleNativeCipcOwnerAction(request: NextRequest, id: string, action: OwnerAction) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action:
      action === "renew" || action === "link"
        ? "business-verification:renew"
        : "business-verification:settings",
    mutate: true,
    requireCaller: action === "work-email",
    successStatus: action === "renew" || action === "link" ? 201 : 200,
    signInMessage: "Sign in to manage your CIPC registration check",
    unavailableMessage: "The change could not be confirmed. Reload your business verification.",
    refusal: staffCommandRefusal,
    command: async (api, body, caller) => {
      const business = z.uuid().parse(id);
      if (action === "renew" || action === "link") {
        let source: string | undefined;
        if (action === "link")
          source = z.strictObject({ sourceBusinessId: z.uuid() }).parse(body).sourceBusinessId;
        else z.strictObject({}).parse(body);
        return settleStaffCommand(
          api.rpc(
            "request_frontend_cipc_recheck",
            {
              p_business: business,
              ...(source ? { p_source: source } : {}),
            },
            { get: false }
          ),
          z.strictObject({ caseId: z.uuid(), status: z.literal("pending") })
        );
      }
      if (action === "route-switch") {
        const input = z.strictObject({ caseId: z.uuid() }).parse(body);
        return settleStaffCommand(
          api.rpc(
            "switch_frontend_cipc_representative",
            {
              p_business: business,
              p_case: input.caseId,
            },
            { get: false }
          ),
          z.strictObject({ ok: z.literal(true) })
        );
      }
      if (action === "office-visibility") {
        const input = z.strictObject({ showFull: z.boolean() }).parse(body);
        return settleStaffCommand(
          api.rpc(
            "set_frontend_cipc_office_visibility",
            {
              p_business: business,
              p_show: input.showFull,
            },
            { get: false }
          ),
          z.strictObject({ showFull: z.literal(input.showFull) })
        );
      }
      if (!caller) throw new Error("Current business owner required");
      const input = requestCode.parse(body);
      const service = createFoundationServiceApi();
      const scope = {
        p_owner: caller.accountId,
        p_session: caller.sessionId,
        p_business: business,
        p_case: input.caseId,
      };
      if (input.action === "send") {
        if (!isWorkEmail(input.email))
          throw new FoundationStaffCommandError(
            422,
            "Use an email address on your company's own domain."
          );
        const current = await readMyBusinessChecks(api, business);
        const code = newCode();
        const issue = await settleStaffCommand(
          service.rpc(
            "start_frontend_cipc_email",
            {
              ...scope,
              p_email: input.email,
              p_position: input.position,
              p_digest: hashCode(input.caseId, code),
            },
            { get: false }
          ),
          z.strictObject({ challenge: z.uuid() })
        );
        const sent = await sendWorkEmailCode({
          email: input.email,
          businessName: current.business.name ?? "Your business",
          code,
        });
        if (!sent.success)
          throw new FoundationStaffCommandError(
            503,
            "The code could not be sent. Wait a minute before trying again."
          );
        const marked = await service.rpc(
          "mark_frontend_cipc_email_sent",
          {
            p_owner: caller.accountId,
            p_session: caller.sessionId,
            p_case: input.caseId,
            p_challenge: issue.challenge,
          },
          { get: false }
        );
        if (marked.error || marked.data !== true)
          throw new Error("Code acknowledgement unavailable");
        return { sent: true };
      }
      const result = await settleStaffCommand(
        service.rpc(
          "verify_frontend_cipc_email",
          {
            ...scope,
            p_digest: hashCode(input.caseId, input.code),
          },
          { get: false }
        ),
        z.strictObject({ verified: z.boolean(), remaining: z.number().int().min(0).max(5) })
      );
      if (!result.verified)
        throw new FoundationStaffCommandError(
          result.remaining ? 400 : 429,
          result.remaining
            ? "That code isn't right."
            : "The code expired or has no attempts left. Request a new one."
        );
      return { verified: true };
    },
  });
}

export function handleNativeCipcStaffAction(
  request: Request,
  id: string,
  action: "representative" | "office",
  schema: z.ZodType<
    | {
        expectedUpdatedAt: string;
        domainConfirmed: boolean;
        callback: {
          numberSource: string;
          spokeTo: string;
          confirmedPosition: string;
          confirmed: boolean;
          notes: string | null;
        };
      }
    | {
        expectedUpdatedAt: string;
        streetLines: string[];
        suburb: string | null;
        city: string;
        province: string;
        postalCode: string | null;
      }
  >
) {
  return handleFoundationOwnerRoute({
    request: request instanceof NextRequest ? request : new NextRequest(request),
    log,
    action: "business-verification:" + action,
    mutate: true,
    requireCaller: true,
    maxBytes: 10000,
    signInMessage: "Sign in to review CIPC registration",
    unavailableMessage: "The CIPC case could not be updated. Reload before retrying.",
    refusal: staffCommandRefusal,
    command: async (api, body, caller) => {
      if (!caller) throw new Error("Current reviewer required");
      const caseId = z.uuid().parse(id);
      const input = schema.parse(body);
      const claim = await currentBusinessClaim(api, caller.accountId, caseId, true);
      if (!claim) throw new Error("Current review claim required");
      const { expectedUpdatedAt, ...fields } = input;
      const scope = {
        p_case: caseId,
        p_expected: z.iso.datetime({ offset: true }).parse(expectedUpdatedAt),
        p_generation: claim.generation,
        p_nonce: claim.nonce,
      };
      if ("callback" in fields)
        return settleStaffCommand(
          api.rpc(
            "record_frontend_cipc_callback",
            {
              ...scope,
              p_domain: fields.domainConfirmed,
              p_callback: fields.callback,
            },
            { get: false }
          ),
          z.strictObject({ ok: z.literal(true), confirmed: z.boolean() })
        );
      return settleStaffCommand(
        api.rpc(
          "correct_frontend_cipc_office",
          {
            ...scope,
            p_office: fields,
          },
          { get: false }
        ),
        z.strictObject({ ok: z.literal(true) })
      );
    },
  });
}
