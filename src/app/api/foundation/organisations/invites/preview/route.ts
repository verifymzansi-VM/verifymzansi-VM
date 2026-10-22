import { NextResponse, type NextRequest } from "next/server";
import { previewFoundationOrganisationInvite } from "@/lib/foundation/organisations";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { handlePublicOrganisationRead } from "../../../_lib/organisation-route";

const log = createLogger("FoundationInvitePreview");

/** What an invitation page may show before sign-in. POST keeps the token out
 * of URLs and access logs; the address is masked. */
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  const body = await parseJsonRequest(request, { maxBytes: 1024 });
  if (body === null)
    return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
  const response = await handlePublicOrganisationRead(request, (api) =>
    previewFoundationOrganisationInvite(api, body)
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
