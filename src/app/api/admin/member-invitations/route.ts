import type { NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  inviteMember,
  memberInvitationRefusal,
  withdrawMemberInvitation,
} from "@/lib/foundation/member-invitations";

const log = createLogger("MemberInvitations");

// The database checks the address's form; this only bounds it.
const address = z.string().trim().min(3).max(254);
const body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("invite"), email: address }),
  z.strictObject({ action: z.literal("withdraw"), email: address }),
]);

/**
 * POST /api/admin/member-invitations
 *
 * Invite a member (or renew a waiting invitation for 30 more days), or
 * withdraw a waiting invitation. A member invitation lets one person create a
 * normal member account; it never gives staff access. Same-origin, CSRF and a
 * per-client rate limit (handleFoundationOwnerRoute); the database checks the
 * caller holds member:invite (admins) with an authenticator check in the last
 * 12 hours, and limits each admin to 200 invitations in 24 hours.
 */
export async function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:member-invitations",
    mutate: true,
    signInMessage: "Sign in to manage member invitations",
    unavailableMessage:
      "The invitation could not be confirmed. Reload the page before trying again.",
    refusal: memberInvitationRefusal,
    command: async (api, input) => {
      const parsed = body.parse(input);
      return parsed.action === "invite"
        ? inviteMember(api, parsed.email)
        : withdrawMemberInvitation(api, parsed.email);
    },
  });
}
