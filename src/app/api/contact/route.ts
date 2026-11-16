import type { NextRequest } from "next/server";
import { postFoundationContactEnquiry } from "@/lib/foundation/contact-enquiry-route";

export async function POST(request: NextRequest) {
  return postFoundationContactEnquiry(request);
}
