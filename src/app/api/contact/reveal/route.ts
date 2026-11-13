import type { NextRequest } from "next/server";
import { revealFoundationContact } from "@/lib/foundation/contact-reveal-route";

/**
 * POST /api/contact/reveal
 * "Show number" for a private seller's or event poster's contact details. Any
 * visitor can use it, no sign-in needed; it is rate-limited per visitor (the
 * account, or the network address when signed out) so numbers can't be
 * collected in bulk, recorded for the poster, and only answers for the
 * methods the poster chose on a live post.
 */
export async function POST(request: NextRequest) {
  return revealFoundationContact(request);
}
