import type { NextRequest } from "next/server";
import { handleFoundationResendConfirmation } from "@/lib/foundation/resend-confirmation-route";

export async function POST(request: NextRequest) {
  return handleFoundationResendConfirmation(request);
}
