import type { NextRequest } from "next/server";
import { handleFoundationRegistration } from "@/lib/foundation/registration-route";

export async function POST(request: NextRequest) {
  return handleFoundationRegistration(request, true);
}
