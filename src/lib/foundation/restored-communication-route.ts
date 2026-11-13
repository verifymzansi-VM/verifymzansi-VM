import "server-only";

import type { NextRequest } from "next/server";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "./owner-route";
import {
  FoundationCommunicationError,
  readCommunicationChoices,
  readEmailHistory,
  saveCommunicationChoices,
} from "./communication-choices";
import { createLogger } from "../utils/logger";

const log = createLogger("RestoredCommunication");

const refusals: Record<FoundationCommunicationError["reason"], [number, string]> = {
  invalid: [400, "Check the details and try again"],
  limited: [429, "Too many changes today; try again tomorrow"],
  unavailable: [503, "Communication settings are temporarily unavailable"],
};

function communicationRefusal(error: unknown): FoundationRefusal | null {
  if (!(error instanceof FoundationCommunicationError)) return null;
  const [status, message] = refusals[error.reason];
  return { status, error: message, reason: error.reason };
}

/** The restored communication page's choices: GET reads, PATCH saves. Each
 * call reaches only the caller's own record through the signed-in session;
 * the database checks the caller again and records every change with the
 * wording version and time. */
export function handleRestoredCommunicationPreferences(
  request: NextRequest,
  method: "GET" | "PATCH"
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: method === "GET" ? "inbox:read" : "profile:update",
    mutate: method === "PATCH",
    unavailableMessage: "Communication settings are temporarily unavailable",
    signInMessage: "Sign in to manage your communication settings",
    command: async (api, input) => {
      if (method === "GET") return { preferences: await readCommunicationChoices(api) };
      return { success: true, preferences: await saveCommunicationChoices(api, input) };
    },
    refusal: communicationRefusal,
  });
}

/** The restored page's account email history: the caller's own finished
 * emails (kind, sent or failed, when), never an address or provider error. */
export function handleRestoredEmailActivity(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    unavailableMessage: "Email history is temporarily unavailable",
    signInMessage: "Sign in to see your email history",
    command: async (api) => ({ items: await readEmailHistory(api) }),
    refusal: communicationRefusal,
  });
}
