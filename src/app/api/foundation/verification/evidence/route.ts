import type { NextRequest } from "next/server";
import { handleFoundationEvidenceRead } from "@/lib/foundation/evidence-route";
export function POST(request: NextRequest) {
  return handleFoundationEvidenceRead(request);
}
